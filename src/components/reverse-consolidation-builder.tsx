'use client';
/**
 * Reverse Consolidation Sheet — builds a client-facing offer for a
 * weekly-disbursement funding consolidation.
 *
 * How a reverse consolidation works (and what this sheet presents): the
 * funder advances the total, but instead of one lump sum the merchant
 * receives scheduled WEEKLY DISBURSEMENTS while their existing MCA
 * positions get paid down — so the offer shows the topline economics,
 * the positions (funders + balances) being consolidated, the week-by-week
 * disbursement schedule, and the requirements to fund.
 *
 * Every economics line can be shown/hidden, requirements are fully
 * editable (contracts from each funder with a balance are auto-suggested),
 * and "Generate PDF" opens a print-ready branded document (company name +
 * logo) the browser saves as PDF. Nothing here writes to the database —
 * a draft is kept in localStorage so work isn't lost on refresh.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PageHeader, Card, CardContent, Button, Input, Field,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { Plus, Trash2, Eye, EyeOff, Printer, RotateCcw, FileText } from 'lucide-react';

/* ---------- helpers ---------- */

function parseNum(v: string): number | null {
  if (!v || !v.trim()) return null;
  const n = Number(v.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function money(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface FunderRow { id: string; name: string; balance: string }
interface ScheduleRow { week: number; date: string; amount: string }

const ECON_FIELDS = [
  { key: 'funding', label: 'Total Funding Amount' },
  { key: 'payback', label: 'Total Payback' },
  { key: 'rate', label: 'Rate' },
  { key: 'term', label: 'Term (weeks)' },
  { key: 'weeklyPayment', label: 'Weekly Payment' },
  { key: 'savings', label: 'Estimated Savings' },
] as const;
type EconKey = typeof ECON_FIELDS[number]['key'];

const DEFAULT_REQUIREMENTS = ['Driver’s license', 'Voided check'];
const DRAFT_KEY = 'reverse-consol-sheet:v1';

let rowSeq = 0;
function rid() { return `r${Date.now().toString(36)}_${rowSeq++}`; }

export function ReverseConsolidationBuilder({
  companyName,
  logoUrl,
}: {
  companyName: string;
  logoUrl: string | null;
}) {
  const toast = useToast();

  const [dealName, setDealName] = useState('');
  const [econ, setEcon] = useState<Record<EconKey, string>>({
    funding: '', payback: '', rate: '', term: '', weeklyPayment: '', savings: '',
  });
  const [shown, setShown] = useState<Record<EconKey, boolean>>({
    funding: true, payback: true, rate: true, term: true, weeklyPayment: true, savings: true,
  });
  const [funders, setFunders] = useState<FunderRow[]>([{ id: rid(), name: '', balance: '' }]);
  const [startDate, setStartDate] = useState('');
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [requirements, setRequirements] = useState<string[]>(DEFAULT_REQUIREMENTS);
  const [newReq, setNewReq] = useState('');
  // Contract requirements the user explicitly deleted — never auto re-added.
  const removedAutoReqsRef = useRef<Set<string>>(new Set());
  const restoredRef = useRef(false);

  /* ---------- draft persistence (localStorage, no DB) ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          if (typeof d.dealName === 'string') setDealName(d.dealName);
          if (d.econ) setEcon((cur) => ({ ...cur, ...d.econ }));
          if (d.shown) setShown((cur) => ({ ...cur, ...d.shown }));
          if (Array.isArray(d.funders) && d.funders.length) setFunders(d.funders);
          if (typeof d.startDate === 'string') setStartDate(d.startDate);
          if (Array.isArray(d.schedule)) setSchedule(d.schedule);
          if (Array.isArray(d.requirements)) setRequirements(d.requirements);
        }
      }
    } catch { /* fresh start */ }
    restoredRef.current = true;
  }, []);
  useEffect(() => {
    if (!restoredRef.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          dealName, econ, shown, funders, startDate, schedule, requirements,
        }));
      } catch { /* storage full/blocked */ }
    }, 400);
    return () => clearTimeout(t);
  }, [dealName, econ, shown, funders, startDate, schedule, requirements]);

  /* ---------- derived economics (suggestions, never overriding typed values) ---------- */
  const derived = useMemo(() => {
    const funding = parseNum(econ.funding);
    const payback = parseNum(econ.payback);
    const rate = parseNum(econ.rate);
    const term = parseNum(econ.term);
    return {
      rate: rate ?? (funding && payback && funding > 0 ? Math.round((payback / funding) * 10000) / 10000 : null),
      payback: payback ?? (funding && rate ? Math.round(funding * rate * 100) / 100 : null),
      weeklyPayment: parseNum(econ.weeklyPayment)
        ?? ((payback ?? (funding && rate ? funding * rate : null)) && term && term > 0
          ? Math.round(((payback ?? (funding! * rate!)) / term) * 100) / 100
          : null),
    };
  }, [econ]);

  /** Effective display value per econ line — typed value wins, else derived. */
  function econValue(key: EconKey): string {
    const typed = econ[key];
    if (typed.trim()) {
      const n = parseNum(typed);
      if (key === 'rate') return n !== null ? n.toFixed(n < 10 ? 2 : 0) : typed;
      if (key === 'term') return n !== null ? `${n} weeks` : typed;
      return n !== null ? money(n) : typed; // free text allowed (e.g. savings note)
    }
    if (key === 'rate' && derived.rate !== null) return derived.rate.toFixed(2);
    if (key === 'payback' && derived.payback !== null) return money(derived.payback);
    if (key === 'weeklyPayment' && derived.weeklyPayment !== null) return money(derived.weeklyPayment);
    return '';
  }

  /* ---------- funders + auto requirements ---------- */
  const funderTotal = useMemo(
    () => funders.reduce((acc, f) => acc + (parseNum(f.balance) ?? 0), 0),
    [funders]
  );

  // Auto-suggest "Contracts from X" for every funder with a balance. Lines
  // the user deleted stay deleted; renames update in place.
  useEffect(() => {
    if (!restoredRef.current) return;
    const wanted = funders
      .filter((f) => f.name.trim() && parseNum(f.balance) !== null)
      .map((f) => `Contracts from ${f.name.trim()}`);
    setRequirements((cur) => {
      const missing = wanted.filter((w) =>
        !cur.some((r) => r.toLowerCase() === w.toLowerCase()) &&
        !removedAutoReqsRef.current.has(w.toLowerCase()));
      return missing.length ? [...cur, ...missing] : cur;
    });
  }, [funders]);

  function removeRequirement(idx: number) {
    setRequirements((cur) => {
      const r = cur[idx];
      if (r?.toLowerCase().startsWith('contracts from ')) {
        removedAutoReqsRef.current.add(r.toLowerCase());
      }
      return cur.filter((_, i) => i !== idx);
    });
  }

  /* ---------- disbursement schedule ---------- */
  function generateSchedule() {
    const funding = parseNum(econ.funding);
    const term = parseNum(econ.term);
    if (!funding || !term || term < 1) {
      toast.error('Enter the total funding amount and the term (weeks) first.');
      return;
    }
    const weeks = Math.round(term);
    const per = Math.floor((funding / weeks) * 100) / 100;
    const start = startDate ? new Date(`${startDate}T00:00:00`) : new Date();
    const rows: ScheduleRow[] = [];
    let allocated = 0;
    for (let w = 0; w < weeks; w++) {
      // Final week absorbs the rounding remainder so the total is exact.
      const amount = w === weeks - 1 ? Math.round((funding - allocated) * 100) / 100 : per;
      allocated += amount;
      rows.push({ week: w + 1, date: fmtDate(addDays(start, w * 7)), amount: String(amount) });
    }
    setSchedule(rows);
  }

  const scheduleTotal = useMemo(
    () => schedule.reduce((acc, r) => acc + (parseNum(r.amount) ?? 0), 0),
    [schedule]
  );

  /* ---------- print / PDF ---------- */
  function generatePdf() {
    if (!dealName.trim()) { toast.error('Enter the deal name first — it headlines the offer.'); return; }
    const econRows = ECON_FIELDS
      .filter((f) => shown[f.key] && econValue(f.key))
      .map((f) => `<tr><td class="k">${esc(f.label)}</td><td class="v">${esc(econValue(f.key))}</td></tr>`)
      .join('');
    const funderRows = funders
      .filter((f) => f.name.trim() || parseNum(f.balance) !== null)
      .map((f) => `<tr><td>${esc(f.name.trim() || '—')}</td><td class="v">${esc(money(parseNum(f.balance)))}</td></tr>`)
      .join('');
    const schedRows = schedule
      .map((r) => `<tr><td>Week ${r.week}</td><td>${esc(r.date)}</td><td class="v">${esc(money(parseNum(r.amount)))}</td></tr>`)
      .join('');
    const reqRows = requirements.filter((r) => r.trim()).map((r) => `<li>${esc(r)}</li>`).join('');
    const today = fmtDate(new Date());

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(dealName)} — Reverse Consolidation Offer</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; padding: 48px 56px; font-size: 13px; line-height: 1.5; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand img { height: 48px; width: auto; max-width: 180px; object-fit: contain; }
  .brand .name { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
  .date { color: #6b7280; font-size: 12px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .sub { color: #6b7280; margin-bottom: 20px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
  td.k { color: #374151; width: 55%; }
  td.v { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  tr.total td { border-top: 2px solid #111827; border-bottom: none; font-weight: 700; }
  ul { padding-left: 18px; }
  li { margin: 3px 0; }
  .note { margin-top: 26px; color: #6b7280; font-size: 11px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
  @media print { body { padding: 24px 28px; } }
</style></head><body>
  <div class="head">
    <div class="brand">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}
      <div class="name">${esc(companyName)}</div>
    </div>
    <div class="date">${esc(today)}</div>
  </div>
  <h1>Reverse Consolidation Offer — ${esc(dealName)}</h1>
  <div class="sub">Funding consolidation structured on weekly disbursements.</div>

  ${econRows ? `<h2>Offer Breakdown</h2><table>${econRows}</table>` : ''}

  ${funderRows ? `<h2>Positions Being Consolidated</h2><table>
    <tr><th>Funder</th><th style="text-align:right">Balance</th></tr>${funderRows}
    <tr class="total"><td>Total balances</td><td class="v">${esc(money(funderTotal))}</td></tr>
  </table>` : ''}

  ${schedRows ? `<h2>Weekly Disbursement Schedule</h2><table>
    <tr><th>Week</th><th>Date</th><th style="text-align:right">Disbursement</th></tr>${schedRows}
    <tr class="total"><td colspan="2">Total disbursed</td><td class="v">${esc(money(scheduleTotal))}</td></tr>
  </table>` : ''}

  ${reqRows ? `<h2>Requirements to Fund</h2><ul>${reqRows}</ul>` : ''}

  <div class="note">Prepared by ${esc(companyName)} on ${esc(today)}. This offer summary is for discussion purposes; final terms are set by the funding agreement.</div>
<script>window.onload = function(){ window.print(); };</script>
</body></html>`;

    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) { toast.error('Your browser blocked the print window — allow pop-ups for this site.'); return; }
    w.document.write(html);
    w.document.close();
  }

  function clearAll() {
    setDealName('');
    setEcon({ funding: '', payback: '', rate: '', term: '', weeklyPayment: '', savings: '' });
    setShown({ funding: true, payback: true, rate: true, term: true, weeklyPayment: true, savings: true });
    setFunders([{ id: rid(), name: '', balance: '' }]);
    setStartDate('');
    setSchedule([]);
    setRequirements(DEFAULT_REQUIREMENTS);
    removedAutoReqsRef.current.clear();
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        title="Reverse Consolidation Sheet"
        description="Build a clean, branded offer for a weekly-disbursement consolidation: economics, positions being consolidated, disbursement schedule, and requirements to fund — then generate a PDF."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={clearAll}><RotateCcw className="h-4 w-4" /> Clear</Button>
            <Button onClick={generatePdf}><Printer className="h-4 w-4" /> Generate PDF</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* ---- LEFT: inputs ---- */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Deal
              </div>
              <Field label="Deal name" required>
                <Input value={dealName} onChange={(e) => setDealName(e.target.value)} placeholder="e.g. ABC Logistics LLC" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold">Offer economics</div>
              <p className="text-xs text-muted-foreground">
                Enter what you have — rate, payback, and weekly payment auto-derive from the others. The eye toggles what shows on the offer.
              </p>
              <div className="space-y-2">
                {ECON_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <button
                      onClick={() => setShown((s) => ({ ...s, [f.key]: !s[f.key] }))}
                      title={shown[f.key] ? 'Shown on the offer — click to hide' : 'Hidden from the offer — click to show'}
                      className={cn('p-1.5 rounded-md transition-colors shrink-0',
                        shown[f.key] ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground/40 hover:bg-muted')}
                    >
                      {shown[f.key] ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <div className="w-40 text-xs font-medium shrink-0">{f.label}</div>
                    <Input
                      className={cn('h-8 flex-1', !shown[f.key] && 'opacity-50')}
                      value={econ[f.key]}
                      onChange={(e) => setEcon((cur) => ({ ...cur, [f.key]: e.target.value }))}
                      placeholder={
                        f.key === 'funding' ? '150,000'
                        : f.key === 'payback' ? `auto: ${derived.payback !== null ? money(derived.payback) : 'funding × rate'}`
                        : f.key === 'rate' ? `auto: ${derived.rate !== null ? derived.rate.toFixed(2) : 'payback ÷ funding'}`
                        : f.key === 'term' ? '26'
                        : f.key === 'weeklyPayment' ? `auto: ${derived.weeklyPayment !== null ? money(derived.weeklyPayment) : 'payback ÷ weeks'}`
                        : 'e.g. $2,400/week vs current payments'
                      }
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold">Positions being consolidated</div>
              <p className="text-xs text-muted-foreground">
                Each funder with a balance is auto-added to Requirements to Fund as &ldquo;Contracts from …&rdquo;.
              </p>
              <div className="space-y-2">
                {funders.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <Input
                      className="h-8 flex-1"
                      value={f.name}
                      onChange={(e) => setFunders((arr) => arr.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))}
                      placeholder="Funder name"
                    />
                    <Input
                      className="h-8 w-36"
                      inputMode="decimal"
                      value={f.balance}
                      onChange={(e) => setFunders((arr) => arr.map((x, xi) => xi === i ? { ...x, balance: e.target.value } : x))}
                      placeholder="Balance"
                    />
                    <button
                      onClick={() => setFunders((arr) => arr.filter((_, xi) => xi !== i))}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-muted"
                      title="Remove funder"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <Button size="sm" variant="outline" onClick={() => setFunders((arr) => [...arr, { id: rid(), name: '', balance: '' }])}>
                  <Plus className="h-3.5 w-3.5" /> Add funder
                </Button>
                <div className="text-xs text-muted-foreground">
                  Total balances: <span className="font-semibold text-foreground tabular-nums">{money(funderTotal)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold">Weekly disbursement schedule</div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="First disbursement" className="w-[170px]">
                  <Input type="date" className="h-8" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Button size="sm" variant="outline" onClick={generateSchedule}>
                  Generate from funding ÷ term
                </Button>
              </div>
              {schedule.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr className="text-left">
                          <th className="px-3 py-1.5 font-semibold">Week</th>
                          <th className="px-3 py-1.5 font-semibold">Date</th>
                          <th className="px-3 py-1.5 font-semibold text-right">Amount</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {schedule.map((r, i) => (
                          <tr key={r.week}>
                            <td className="px-3 py-1">Week {r.week}</td>
                            <td className="px-3 py-1 text-muted-foreground">{r.date}</td>
                            <td className="px-1 py-0.5 text-right">
                              <input
                                value={r.amount}
                                onChange={(e) => setSchedule((arr) => arr.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))}
                                className="w-24 text-right bg-transparent px-2 py-0.5 rounded outline-none focus:ring-1 focus:ring-ring/40 tabular-nums"
                              />
                            </td>
                            <td className="pr-2">
                              <button
                                onClick={() => setSchedule((arr) => arr.filter((_, xi) => xi !== i))}
                                className="p-0.5 rounded text-muted-foreground/40 hover:text-rose-500"
                                title="Remove week"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-1.5 border-t border-border bg-muted/20 text-xs flex justify-between">
                    <span className="text-muted-foreground">Total disbursed</span>
                    <span className="font-semibold tabular-nums">{money(scheduleTotal)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold">Requirements to fund</div>
              <div className="space-y-1.5">
                {requirements.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="h-8 flex-1"
                      value={r}
                      onChange={(e) => setRequirements((arr) => arr.map((x, xi) => xi === i ? e.target.value : x))}
                    />
                    <button
                      onClick={() => removeRequirement(i)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-muted"
                      title="Remove requirement"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 flex-1"
                    value={newReq}
                    onChange={(e) => setNewReq(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newReq.trim()) {
                        setRequirements((arr) => [...arr, newReq.trim()]);
                        setNewReq('');
                      }
                    }}
                    placeholder="Add a requirement…"
                  />
                  <Button size="sm" variant="outline" onClick={() => {
                    if (!newReq.trim()) return;
                    setRequirements((arr) => [...arr, newReq.trim()]);
                    setNewReq('');
                  }}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ---- RIGHT: live preview ---- */}
        <Card className="lg:sticky lg:top-4">
          <CardContent className="p-5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-3">Offer preview</div>
            <div className="rounded-lg border border-border bg-card p-5 space-y-4 text-sm">
              <div className="flex items-center justify-between gap-3 border-b-2 border-foreground pb-3">
                <div className="flex items-center gap-3 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {logoUrl && <img src={logoUrl} alt="" className="h-9 w-auto max-w-[120px] object-contain" />}
                  <div className="font-bold truncate">{companyName}</div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">{fmtDate(new Date())}</div>
              </div>
              <div>
                <div className="font-semibold">Reverse Consolidation Offer{dealName ? ` — ${dealName}` : ''}</div>
                <div className="text-xs text-muted-foreground">Funding consolidation structured on weekly disbursements.</div>
              </div>

              {ECON_FIELDS.some((f) => shown[f.key] && econValue(f.key)) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Offer breakdown</div>
                  <div className="divide-y divide-border/60">
                    {ECON_FIELDS.filter((f) => shown[f.key] && econValue(f.key)).map((f) => (
                      <div key={f.key} className="flex justify-between py-1">
                        <span className="text-muted-foreground">{f.label}</span>
                        <span className="font-semibold tabular-nums">{econValue(f.key)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {funders.some((f) => f.name.trim() || parseNum(f.balance) !== null) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Positions being consolidated</div>
                  <div className="divide-y divide-border/60">
                    {funders.filter((f) => f.name.trim() || parseNum(f.balance) !== null).map((f) => (
                      <div key={f.id} className="flex justify-between py-1">
                        <span>{f.name.trim() || '—'}</span>
                        <span className="font-semibold tabular-nums">{money(parseNum(f.balance))}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 border-t-2 !border-foreground">
                      <span className="font-semibold">Total balances</span>
                      <span className="font-bold tabular-nums">{money(funderTotal)}</span>
                    </div>
                  </div>
                </div>
              )}

              {schedule.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                    Weekly disbursements — {schedule.length} weeks, {money(scheduleTotal)} total
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {schedule.slice(0, 3).map((r) => `Wk ${r.week}: ${money(parseNum(r.amount))}`).join(' · ')}
                    {schedule.length > 3 && ` · … · Wk ${schedule[schedule.length - 1].week}: ${money(parseNum(schedule[schedule.length - 1].amount))}`}
                    <span className="block mt-0.5">(full schedule appears on the PDF)</span>
                  </div>
                </div>
              )}

              {requirements.some((r) => r.trim()) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Requirements to fund</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-xs">
                    {requirements.filter((r) => r.trim()).map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <Button onClick={generatePdf}><Printer className="h-4 w-4" /> Generate PDF</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
