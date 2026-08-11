'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, Button, Input, Field, PageHeader, CurrencyInput, PercentInput } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { Plus, Trash2, Copy } from 'lucide-react';

/**
 * Doc Request
 * ───────────
 * Form-based generator for the "send docs" message a broker fires off to
 * a funder once a deal is verbally approved. The output is a clean
 * copy-paste block that drops cleanly into an email or Slack message.
 *
 * No persistence — the page is a stateless utility. Nothing is saved
 * server-side; the form lives in component state and resets on refresh.
 * Per spec this is intentional: it's a formatter, not a record system.
 *
 * Fee field auto-percent-formats via the existing PercentInput primitive
 * (broker types "5" → renders "5%"). Funding amount uses CurrencyInput.
 * Term has a day/week toggle. EPO is a dynamic list of rows the broker
 * can add or remove.
 */
export default function DocRequestPage() {
  const toast = useToast();
  // Core financial fields
  const [fundingAmount, setFundingAmount] = useState<string>('');
  const [rate, setRate] = useState<string>('');
  const [feePct, setFeePct] = useState<string>('');
  const [termCount, setTermCount] = useState<string>('');
  const [termUnit, setTermUnit] = useState<'days' | 'weeks'>('days');
  // Refi toggle — when the deal is a refinance, the message opens with
  // "Send refi docs for …" instead of "Send docs for …".
  const [isRefi, setIsRefi] = useState(false);
  // Merchant contact
  const [merchantEmail, setMerchantEmail] = useState<string>('');
  // Phone is stored raw (digits + formatting) — formatted live as the
  // user types via formatPhone() below.
  const [merchantCell, setMerchantCell] = useState<string>('');
  // Free-form notes (anything else the funder should know).
  const [notes, setNotes] = useState<string>('');

  /**
   * EPO rows — dynamic array. Each row is "X days → factor Y".
   * Starts with three blank rows because the most common format
   * is a three-step EPO ladder. Broker can add or remove freely.
   */
  type EpoRow = { id: string; days: string; factor: string };
  const [epos, setEpos] = useState<EpoRow[]>([
    { id: cryptoId(), days: '', factor: '' },
    { id: cryptoId(), days: '', factor: '' },
    { id: cryptoId(), days: '', factor: '' },
  ]);

  function addEpo() {
    setEpos((rows) => [...rows, { id: cryptoId(), days: '', factor: '' }]);
  }
  function removeEpo(id: string) {
    // EPO lines are optional — removing all of them is fine. The
    // generated message just omits the EPO line when none are populated.
    setEpos((rows) => rows.filter((r) => r.id !== id));
  }
  function updateEpo(id: string, patch: Partial<EpoRow>) {
    setEpos((rows) => rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

  // Currency formatter for the generated message — strips trailing
  // zeros on the funding amount so "$100,000.00" reads as "$100,000".
  function fmtMoney(s: string): string {
    const n = Number(s.replace(/[^0-9.]/g, ''));
    if (!isFinite(n) || n <= 0) return '';
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }

  /**
   * Compose the message. Built top-down so each line maps 1:1 to a
   * form field. Lines with no value are skipped so the output stays
   * tight if the broker only fills part of the form.
   */
  const message = useMemo(() => {
    const lines: string[] = [];
    const moneyStr = fmtMoney(fundingAmount);
    const docsWord = isRefi ? 'refi docs' : 'docs';
    if (moneyStr) lines.push(`Send ${docsWord} for ${moneyStr}`);
    if (rate)     lines.push(`Rate: ${rate}`);
    if (feePct)   lines.push(`Fee: ${feePct}%`);
    if (termCount) lines.push(`Term: ${termCount} ${termUnit}`);

    // EPO line — flatten populated rows into one line.
    //   "EPO: 1.10 / 30 days, 1.20 / 60 days, 1.30 / 90 days"
    // Format is "factor / days" per spec — factor first because that's
    // what the funder cares about (the price point); days second is
    // context (when that price kicks in).
    const epoParts = epos
      .map((r) => ({ d: r.days.trim(), f: r.factor.trim() }))
      .filter((r) => r.d && r.f)
      .map((r) => `${r.f} / ${r.d} days`);
    if (epoParts.length > 0) {
      lines.push(`EPO: ${epoParts.join(', ')}`);
    }

    if (merchantEmail) lines.push(`Merchant Email: ${merchantEmail.trim()}`);
    if (merchantCell)  lines.push(`Merchant Cell: ${merchantCell.trim()}`);
    if (notes) lines.push(`Notes: ${notes.trim()}`);

    return lines.join('\n');
  }, [fundingAmount, rate, feePct, termCount, termUnit, isRefi, epos, merchantEmail, merchantCell, notes]);

  async function copyMessage() {
    if (!message) {
      toast.error('Fill in at least one field first.');
      return;
    }
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Message copied — paste into your email.');
    } catch {
      // Some browsers (or insecure contexts) block clipboard. Fall back
      // to selecting the textarea so the user can ⌘C / Ctrl+C manually.
      const ta = document.getElementById('doc-request-preview') as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        ta.select();
      }
      toast.error('Could not auto-copy — message is selected, press ⌘C / Ctrl+C.');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Doc Request"
        description="Generate a clean copy-paste message to request contracts from a funder."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Form */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="text-sm font-semibold">Deal details</div>

            {/* Refi toggle — flips the opening line to "Send refi docs". */}
            <Field label="Is this a refi?">
              <div className="inline-flex rounded-md border border-input bg-card p-0.5" role="group">
                <button
                  type="button"
                  onClick={() => setIsRefi(false)}
                  className={`h-9 px-4 rounded text-xs font-medium transition-colors ${
                    !isRefi ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => setIsRefi(true)}
                  className={`h-9 px-4 rounded text-xs font-medium transition-colors ${
                    isRefi ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Yes — refi
                </button>
              </div>
            </Field>

            <Field label="Funding amount">
              {/* CurrencyInput adds $ prefix + commas as the user types. */}
              <CurrencyInput
                value={fundingAmount}
                onChange={setFundingAmount}
                placeholder="100,000"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Rate (factor)">
                <Input
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="1.45"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Fee (%)">
                {/* PercentInput renders "5" as "5%" automatically — the
                    spec called for the system to format the percent so
                    the broker only types the number. */}
                <PercentInput
                  value={feePct}
                  onChange={setFeePct}
                  placeholder="5"
                />
              </Field>
            </div>

            <Field label="Term">
              <div className="flex gap-2">
                <Input
                  value={termCount}
                  onChange={(e) => setTermCount(e.target.value)}
                  placeholder="100"
                  inputMode="numeric"
                  className="flex-1"
                />
                <div className="inline-flex rounded-md border border-input bg-card p-0.5" role="group">
                  <button
                    type="button"
                    onClick={() => setTermUnit('days')}
                    className={`h-9 px-3 rounded text-xs font-medium transition-colors ${
                      termUnit === 'days' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Days
                  </button>
                  <button
                    type="button"
                    onClick={() => setTermUnit('weeks')}
                    className={`h-9 px-3 rounded text-xs font-medium transition-colors ${
                      termUnit === 'weeks' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Weeks
                  </button>
                </div>
              </div>
            </Field>

            {/* EPO ladder — dynamic rows so the broker can add as many
                step-downs as the deal calls for. Each row is days +
                factor. Add Another EPO button appends a new blank row;
                trash icon removes a row (minimum one row always kept). */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Early payoff discounts (EPO)
                </div>
                <button
                  type="button"
                  onClick={addEpo}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add another EPO
                </button>
              </div>

              <div className="space-y-2">
                {epos.length === 0 && (
                  <div className="text-[11px] text-muted-foreground italic">
                    No EPO lines. Click "Add another EPO" to add one.
                  </div>
                )}
                {epos.map((row, i) => (
                  <div key={row.id} className="flex items-center gap-2">
                    {/* Factor first (left), days second (right) — mirrors
                        the generated output format "1.10 / 30 days" so
                        what the broker sees in the form matches what
                        ends up in the message. */}
                    <Input
                      value={row.factor}
                      onChange={(e) => updateEpo(row.id, { factor: e.target.value })}
                      placeholder={`${(1.10 + i * 0.1).toFixed(2)}`}
                      inputMode="decimal"
                      className="w-24"
                      aria-label={`EPO ${i + 1} factor`}
                    />
                    <span className="text-muted-foreground">/</span>
                    <Input
                      value={row.days}
                      onChange={(e) => updateEpo(row.id, { days: e.target.value })}
                      placeholder={`${(i + 1) * 30}`}
                      inputMode="numeric"
                      className="w-24"
                      aria-label={`EPO ${i + 1} days`}
                    />
                    <span className="text-xs text-muted-foreground">days</span>
                    {/* Trash button is always enabled — EPO rows are
                        purely optional, so removing the last one is
                        valid. (The previous "must keep one row" rule
                        confused users who thought the button was
                        broken when they couldn't delete their last
                        line.) */}
                    <button
                      type="button"
                      onClick={() => removeEpo(row.id)}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Remove this EPO line"
                      aria-label="Remove EPO line"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 pt-2 border-t border-border">
              <Field label="Merchant email">
                <Input
                  type="email"
                  value={merchantEmail}
                  onChange={(e) => setMerchantEmail(e.target.value)}
                  placeholder="merchant@email.com"
                />
              </Field>
              <Field label="Merchant cell">
                {/* Auto-formats the phone as the user types. Backing state
                    holds the formatted string directly so what's shown
                    is what gets serialized into the message. */}
                <Input
                  type="tel"
                  value={merchantCell}
                  onChange={(e) => setMerchantCell(formatPhone(e.target.value))}
                  placeholder="(305) 000-0000"
                  inputMode="tel"
                  maxLength={14}
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything else the funder should know (special instructions, situation, etc.)"
                  rows={3}
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: Live preview + copy */}
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Message preview</div>
              <Button onClick={copyMessage} size="sm" className="gap-1.5" disabled={!message}>
                <Copy className="h-3.5 w-3.5" />
                Copy message
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Updates as you fill the form. Paste into your email when ready.
            </div>
            <textarea
              id="doc-request-preview"
              readOnly
              value={message || 'Fill in the form on the left to generate your message.'}
              rows={14}
              className="w-full font-mono text-sm rounded-md border border-input bg-muted/30 p-3 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              aria-label="Generated doc request message"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Stable opaque id for an EPO row. crypto.randomUUID isn't universally
 * available (old browsers, jsdom), so we fall back to a timestamp + random
 * suffix combo. The id is only used as a React key — no security or
 * uniqueness requirements beyond "different from its siblings".
 */
function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Format a US phone number as the user types.
 *
 * Strips all non-digit characters, takes the first 10 digits, and
 * groups them as `(AAA) BBB-CCCC`. Partial inputs format progressively:
 *   "3"           → "(3"
 *   "30"          → "(30"
 *   "305"         → "(305) "
 *   "30500"       → "(305) 00"
 *   "3050001234"  → "(305) 000-1234"
 *
 * Extra digits beyond the 10th are dropped silently — the input also
 * has maxLength so the user can't keep typing past a valid US number.
 * If the raw input is shorter than 4 digits we return the partial
 * "(NNN" so backspacing through the format characters works naturally.
 */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
