'use client';
/**
 * Syndication board.
 *
 * Each deal is a COLLAPSED row — deal name + the numbers that matter
 * (funding, available, committed) — that expands for full terms, the
 * syndication entries, and the add-me-in form.
 *
 * The poster marks how much is AVAILABLE for syndication (a dollar amount or
 * a percent of the funding amount); entries are capped server-side so the
 * board can never oversell a deal.
 *
 * Copy = one line per entry: "Company $Amount". Nothing else.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHeader, Card, CardContent, Button, Input, Textarea, Field, Badge, EmptyState,
  CurrencyInput, PercentInput, Select,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-provider';
import { formatCurrency, cn } from '@/lib/utils';
import { Handshake, Copy, Plus, Trash2, Lock, Unlock, ChevronDown, ChevronRight } from 'lucide-react';

interface Entry {
  id: string;
  userId: string | null;
  repName: string;
  companyName: string | null;
  amount: string;
  createdAt: string;
}
interface SynDeal {
  id: string;
  dealName: string;
  fundingAmount: string | null;
  availableAmount: string | null;
  availablePct: string | null;
  availableCap: number | null;
  term: string | null;
  rate: string | null;
  commission: string | null;
  fee: string | null;
  hasEarlyPayoff: boolean;
  earlyPayoffDetails: string | null;
  funderName: string | null;
  positionNumber: string | null;
  notes: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  entries: Entry[];
  committedTotal: number;
}
interface DirectoryRep {
  id: string;
  repName: string;
  repCompanyName: string | null;
}

const BLANK_FORM = {
  dealName: '', fundingAmount: '', availableMode: 'amount' as 'amount' | 'pct',
  availableAmount: '', availablePct: '',
  term: '', rate: '', commission: '', fee: '',
  hasEarlyPayoff: false, earlyPayoffDetails: '', funderName: '', positionNumber: '', notes: '',
};

/** Copy = "Company $Amount" per line. Falls back to rep name if no company. */
function buildCopyText(d: SynDeal): string {
  return d.entries
    .map((e) => `${e.companyName || e.repName} ${formatCurrency(e.amount)}`)
    .join('\n');
}

export default function SyndicationPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [me, setMe] = useState<{ id?: string; name?: string; role?: string } | undefined>(undefined);
  const isAdmin = me?.role === 'company_admin' || me?.role === 'master_admin';

  const [dealsList, setDealsList] = useState<SynDeal[]>([]);
  const [directory, setDirectory] = useState<DirectoryRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPost, setShowPost] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [posting, setPosting] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { repId: string; newName: string; newCompany: string; amount: string }>>({});

  async function load() {
    try {
      const [sRes, dirRes, meRes] = await Promise.all([
        fetch('/api/syndication', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/syndication/reps', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ]);
      if (sRes?.data) setDealsList(sRes.data);
      if (dirRes?.data) setDirectory(dirRes.data);
      if (meRes?.user) setMe(meRes.user);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const visible = useMemo(
    () => dealsList.filter((d) => showClosed || d.status === 'open'),
    [dealsList, showClosed]
  );

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function draftFor(dealId: string) {
    return drafts[dealId] ?? { repId: '', newName: '', newCompany: '', amount: '' };
  }
  function setDraft(dealId: string, patch: Partial<{ repId: string; newName: string; newCompany: string; amount: string }>) {
    setDrafts((m) => ({ ...m, [dealId]: { ...draftFor(dealId), ...patch } }));
  }

  async function postDeal() {
    if (!form.dealName.trim()) { toast.error('Deal name is required.'); return; }
    setPosting(true);
    try {
      const res = await fetch('/api/syndication', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealName: form.dealName,
          fundingAmount: form.fundingAmount ? Number(form.fundingAmount) : null,
          availableAmount: form.availableMode === 'amount' && form.availableAmount ? Number(form.availableAmount) : null,
          availablePct: form.availableMode === 'pct' && form.availablePct ? Number(form.availablePct) : null,
          term: form.term, rate: form.rate, commission: form.commission, fee: form.fee,
          hasEarlyPayoff: form.hasEarlyPayoff,
          earlyPayoffDetails: form.earlyPayoffDetails,
          funderName: form.funderName, positionNumber: form.positionNumber, notes: form.notes,
        }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Could not post the deal.'); return; }
      toast.success('Deal posted for syndication.');
      setForm({ ...BLANK_FORM });
      setShowPost(false);
      load();
    } finally {
      setPosting(false);
    }
  }

  async function addEntry(deal: SynDeal) {
    const d = draftFor(deal.id);
    const isNew = d.repId === '__new';
    const dirRep = directory.find((r) => r.id === d.repId);
    const repName = isNew ? d.newName.trim() : (dirRep?.repName ?? '');
    const companyName = isNew ? d.newCompany.trim() : (dirRep?.repCompanyName ?? '');
    const amount = Number(d.amount);
    if (!repName) { toast.error(isNew ? 'Enter the rep name.' : 'Pick who you are first.'); return; }
    if (!amount || amount <= 0) { toast.error('Enter the amount you want to syndicate.'); return; }
    const res = await fetch(`/api/syndication/${deal.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repName, companyName: companyName || null, amount }),
    });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || 'Could not add your entry.'); return; }
    toast.success('You’re in.');
    setDraft(deal.id, { amount: '', ...(isNew ? { repId: '', newName: '', newCompany: '' } : {}) });
    load();
  }

  async function removeEntry(entry: Entry) {
    const ok = await confirm({
      title: 'Remove this entry?',
      description: `${entry.companyName || entry.repName} ${formatCurrency(entry.amount)}`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/syndication/entries/${entry.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Entry removed.'); load(); }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Could not remove.'); }
  }

  async function setStatus(deal: SynDeal, status: 'open' | 'closed') {
    const res = await fetch(`/api/syndication/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) { toast.success(status === 'closed' ? 'Syndication closed.' : 'Reopened.'); load(); }
  }

  async function removeDeal(deal: SynDeal) {
    const ok = await confirm({
      title: 'Remove this deal from the board?',
      description: `"${deal.dealName}" and its ${deal.entries.length} entr${deal.entries.length === 1 ? 'y' : 'ies'} will be removed. Your CRM deals are not affected.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/syndication/${deal.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Removed from the board.'); load(); }
  }

  async function copyDeal(d: SynDeal) {
    if (!d.entries.length) { toast.error('No syndication entries to copy yet.'); return; }
    try {
      await navigator.clipboard.writeText(buildCopyText(d));
      toast.success('Copied.');
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Syndication"
        description="Deals open for syndication — expand a deal for the full terms, pick your name, and put your amount in."
        actions={
          <Button onClick={() => setShowPost((v) => !v)}>
            <Plus className="h-4 w-4" /> Post a deal
          </Button>
        }
      />

      {showPost && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold">Post a deal for syndication</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Deal name" required>
                <Input value={form.dealName} onChange={(e) => setForm({ ...form, dealName: e.target.value })} placeholder="Merchant / deal name" />
              </Field>
              <Field label="Funding amount">
                <CurrencyInput value={form.fundingAmount} onChange={(v) => setForm({ ...form, fundingAmount: v })} placeholder="150,000" />
              </Field>
              <Field label="Available for syndication">
                <div className="flex items-center gap-1.5">
                  {form.availableMode === 'amount' ? (
                    <CurrencyInput value={form.availableAmount} onChange={(v) => setForm({ ...form, availableAmount: v })} placeholder="75,000" className="flex-1" />
                  ) : (
                    <PercentInput value={form.availablePct} onChange={(v) => setForm({ ...form, availablePct: v })} placeholder="50" className="flex-1" />
                  )}
                  <div className="flex rounded-lg border border-input overflow-hidden shrink-0">
                    {(['amount', 'pct'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setForm({ ...form, availableMode: m })}
                        className={cn(
                          'h-10 px-2.5 text-xs font-semibold transition-colors',
                          form.availableMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {m === 'amount' ? '$' : '%'}
                      </button>
                    ))}
                  </div>
                </div>
              </Field>
              <Field label="Term">
                <Input value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} placeholder="e.g. 120 business days" />
              </Field>
              <Field label="Rate">
                <Input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="e.g. 1.45" />
              </Field>
              <Field label="Commission">
                <Input value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} placeholder="e.g. 10 points" />
              </Field>
              <Field label="Fee">
                <Input value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} placeholder="e.g. 3% origination" />
              </Field>
              <Field label="Funder">
                <Input value={form.funderName} onChange={(e) => setForm({ ...form, funderName: e.target.value })} placeholder="Funding with" />
              </Field>
              <Field label="Position #">
                <Input value={form.positionNumber} onChange={(e) => setForm({ ...form, positionNumber: e.target.value })} placeholder="e.g. 2nd" />
              </Field>
              <Field label="Early payoff">
                <label className="flex items-center gap-2 h-10 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={form.hasEarlyPayoff}
                    onChange={(e) => setForm({ ...form, hasEarlyPayoff: e.target.checked })}
                  />
                  {form.hasEarlyPayoff && <span className="text-sm">Yes — describe below</span>}
                </label>
              </Field>
            </div>
            {form.hasEarlyPayoff && (
              <Field label="Early payoff details">
                <Input value={form.earlyPayoffDetails} onChange={(e) => setForm({ ...form, earlyPayoffDetails: e.target.value })} placeholder="e.g. 20% discount if paid within 30 days" />
              </Field>
            )}
            <Field label="Additional notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything else syndicators should know" />
            </Field>
            <div className="flex items-center gap-2">
              <Button onClick={postDeal} disabled={posting}>{posting ? 'Posting…' : 'Post to board'}</Button>
              <Button variant="ghost" onClick={() => { setShowPost(false); setForm({ ...BLANK_FORM }); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" className="h-4 w-4" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show closed
        </label>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No deals on the board"
          description="Post a deal to open it up for syndication — reps can then put in the amount they want."
        />
      ) : (
        <div className="space-y-2">
          {visible.map((d) => {
            const isOpen = expanded.has(d.id);
            const cap = d.availableCap;
            const remaining = cap != null ? Math.max(0, cap - d.committedTotal) : null;
            const pctFilled = cap != null && cap > 0 ? Math.min(100, Math.round((d.committedTotal / cap) * 100)) : null;
            const canManage = isAdmin || d.createdBy === me?.id;
            const draft = draftFor(d.id);
            const isNewRep = draft.repId === '__new';
            const full = remaining != null && remaining <= 0;
            return (
              <div key={d.id} className={cn('rounded-xl border border-border bg-card overflow-hidden', d.status !== 'open' && 'opacity-70')}>
                {/* Collapsed row */}
                <button
                  type="button"
                  onClick={() => toggle(d.id)}
                  className={cn('w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-muted/40 transition-colors', isOpen && 'bg-muted/30')}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="font-semibold text-sm truncate">{d.dealName}</span>
                  <Badge className={cn('shrink-0', d.status === 'open'
                    ? (full ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-emerald-100 text-emerald-800 border-emerald-200')
                    : 'bg-gray-100 text-gray-600 border-gray-200')}>
                    {d.status !== 'open' ? 'Closed' : full ? 'Full' : 'Open'}
                  </Badge>
                  <span className="ml-auto hidden sm:flex items-center gap-4 text-[13px] shrink-0">
                    {d.fundingAmount && (
                      <span className="text-muted-foreground">Funding <span className="text-foreground font-medium tabular-nums">{formatCurrency(d.fundingAmount)}</span></span>
                    )}
                    {cap != null && (
                      <span className="text-muted-foreground">Available <span className="text-foreground font-medium tabular-nums">{formatCurrency(remaining ?? cap)}</span></span>
                    )}
                    <span className="text-muted-foreground">In <span className="text-foreground font-medium tabular-nums">{formatCurrency(d.committedTotal)}</span>{pctFilled !== null && <span className="text-muted-foreground/70"> ({pctFilled}%)</span>}</span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); copyDeal(d); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); copyDeal(d); } }}
                    title="Copy: company + amount per entry"
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <Copy className="h-4 w-4" />
                  </span>
                </button>

                {/* Expanded body */}
                {isOpen && (
                  <div className="border-t border-border px-4 py-3.5 space-y-3.5">
                    {/* Terms — one tight line-wrapped strip */}
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
                      <TermInline label="Funding" value={d.fundingAmount ? formatCurrency(d.fundingAmount) : null} />
                      <TermInline label="Available" value={cap != null ? `${formatCurrency(cap)}${d.availablePct != null && d.availableAmount == null ? ` (${Number(d.availablePct)}%)` : ''}` : null} />
                      <TermInline label="Term" value={d.term} />
                      <TermInline label="Rate" value={d.rate} />
                      <TermInline label="Commission" value={d.commission} />
                      <TermInline label="Fee" value={d.fee} />
                      <TermInline label="Funder" value={d.funderName} />
                      <TermInline label="Position" value={d.positionNumber} />
                      {d.hasEarlyPayoff && <TermInline label="Early payoff" value={d.earlyPayoffDetails || 'Yes'} />}
                    </div>
                    {d.notes && <p className="text-[13px] text-muted-foreground whitespace-pre-wrap">{d.notes}</p>}

                    {/* Fill bar toward the available cap */}
                    {pctFilled !== null && (
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 flex-1 max-w-[280px] rounded-full bg-muted overflow-hidden">
                          <div className={cn('h-full rounded-full transition-all', full ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${pctFilled}%` }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {formatCurrency(d.committedTotal)} of {formatCurrency(cap!)} · {formatCurrency(remaining!)} left
                        </span>
                      </div>
                    )}

                    {/* Entries — compact: company + amount side by side */}
                    {d.entries.length > 0 && (
                      <div className="max-w-md rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
                        {d.entries.map((e) => (
                          <div key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                            <span className="font-medium">{e.companyName || e.repName}</span>
                            {e.companyName && <span className="text-[11px] text-muted-foreground">({e.repName})</span>}
                            <span className="ml-auto tabular-nums font-semibold">{formatCurrency(e.amount)}</span>
                            {(isAdmin || e.userId === me?.id) && (
                              <button onClick={() => removeEntry(e)} className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-rose-500" title="Remove entry">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                        <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] bg-muted/30">
                          <span className="font-semibold">Total</span>
                          <span className="ml-auto tabular-nums font-semibold">{formatCurrency(d.committedTotal)}</span>
                          {(isAdmin || d.entries.some((e) => e.userId === me?.id)) && <span className="w-[18px]" />}
                        </div>
                      </div>
                    )}

                    {/* Add my entry */}
                    {d.status === 'open' && !full && (
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label="I am" className="w-[180px]">
                          <Select className="h-9" value={draft.repId} onChange={(e) => setDraft(d.id, { repId: e.target.value })}>
                            <option value="">Select rep…</option>
                            {directory.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.repName}{r.repCompanyName ? ` — ${r.repCompanyName}` : ''}
                              </option>
                            ))}
                            <option value="__new">+ New rep…</option>
                          </Select>
                        </Field>
                        {isNewRep && (
                          <>
                            <Field label="Rep name" className="flex-1 min-w-[120px]">
                              <Input className="h-9" value={draft.newName} onChange={(e) => setDraft(d.id, { newName: e.target.value })} placeholder="Your name" />
                            </Field>
                            <Field label="Company" className="flex-1 min-w-[120px]">
                              <Input className="h-9" value={draft.newCompany} onChange={(e) => setDraft(d.id, { newCompany: e.target.value })} placeholder="Your company" />
                            </Field>
                          </>
                        )}
                        <Field label="Amount" className="w-[140px]">
                          <CurrencyInput className="h-9" value={draft.amount} onChange={(v) => setDraft(d.id, { amount: v })} placeholder="25,000" />
                        </Field>
                        <Button size="sm" onClick={() => addEntry(d)} className="h-9">
                          <Plus className="h-3.5 w-3.5" /> Add me in
                        </Button>
                      </div>
                    )}
                    {d.status === 'open' && full && (
                      <div className="text-[13px] text-amber-700 dark:text-amber-400 font-medium">Fully committed — nothing left available.</div>
                    )}

                    {/* Manage */}
                    {canManage && (
                      <div className="flex items-center gap-2 pt-1 border-t border-border/60">
                        {d.status === 'open'
                          ? <Button size="sm" variant="ghost" onClick={() => setStatus(d, 'closed')}><Lock className="h-3.5 w-3.5" /> Close</Button>
                          : <Button size="sm" variant="ghost" onClick={() => setStatus(d, 'open')}><Unlock className="h-3.5 w-3.5" /> Reopen</Button>}
                        <Button size="sm" variant="ghost" onClick={() => removeDeal(d)}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TermInline({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{label}:</span>{' '}
      <span className="font-medium">{value}</span>
    </span>
  );
}
