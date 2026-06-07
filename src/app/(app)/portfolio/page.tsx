'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, PageHeader, Input } from '@/components/ui/primitives';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';
import { computePaydown, DEAL_STATUS_META } from '@/lib/deals/paydown';

interface Deal {
  id: string;
  name: string;
  merchantFirstName: string | null;
  merchantLastName: string | null;
  status: string;
  fundedAmount: string | null;
  feePct: string | null;
  factorRate: string | null;
  termMode: string | null;
  termCount: string | null;
  fundingDate: string | null;
  amountCollected: string | null;
  assignedRepId: string | null;
}

const TONE_CLASS: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-800 border-amber-200', blue: 'bg-blue-100 text-blue-800 border-blue-200',
  gray: 'bg-gray-100 text-gray-700 border-gray-200', slate: 'bg-slate-100 text-slate-700 border-slate-200',
  violet: 'bg-violet-100 text-violet-800 border-violet-200', emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  rose: 'bg-rose-100 text-rose-800 border-rose-200', red: 'bg-red-100 text-red-800 border-red-200',
  orange: 'bg-orange-100 text-orange-800 border-orange-200', teal: 'bg-teal-100 text-teal-800 border-teal-200',
  cyan: 'bg-cyan-100 text-cyan-800 border-cyan-200',
};
const meta = (s: string) => DEAL_STATUS_META[s] ?? { label: s, tone: 'gray' };

type SortKey = 'recent' | 'pct_desc' | 'pct_asc' | 'balance_desc' | 'funded_desc';

export default function PortfolioPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'all' | 'paying' | 'refi'>('all');
  const [sort, setSort] = useState<SortKey>('recent');

  useEffect(() => {
    fetch('/api/deals', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      setDeals((j.data ?? j.deals ?? []) as Deal[]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Compute paydown for each FUNDED deal (live, as of today). We restrict
  // to status='funded' (and legacy aliases) so the Funded Deals page never
  // surfaces a deal that's still in the active pipeline.
  const FUNDED_STATUSES = new Set(['funded', 'paid_off', 'closed']);
  const enriched = useMemo(() => deals
    .filter((d) => FUNDED_STATUSES.has(d.status))
    .map((d) => ({
      deal: d,
      p: computePaydown({
        fundedAmount: d.fundedAmount, factorRate: d.factorRate, termMode: d.termMode,
        termCount: d.termCount, fundingDate: d.fundingDate, amountCollected: d.amountCollected,
      }),
    })), [deals]);

  const portfolio = useMemo(() => {
    // Include EVERY funded-status deal — both ones with a paydown structure
    // (full set: fundedAmount + factor + term + fundingDate) and ones that
    // still need funding details entered. The previous filter dropped the
    // un-populated cards entirely; per the new spec, funding details are
    // now entered HERE on Funded Deals (not Active Deals), so we have to
    // surface the cards that need attention.
    let list = enriched;
    if (view === 'paying') list = list.filter((e) => e.p.hasStructure && !e.p.renewalEligible && e.p.pctPaidIn < 100);
    if (view === 'refi') list = list.filter((e) => e.p.hasStructure && e.p.renewalEligible);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) =>
        e.deal.name.toLowerCase().includes(q) ||
        `${e.deal.merchantFirstName ?? ''} ${e.deal.merchantLastName ?? ''}`.toLowerCase().includes(q));
    }
    const sorted = [...list];
    switch (sort) {
      case 'pct_desc': sorted.sort((a, b) => b.p.pctPaidIn - a.p.pctPaidIn); break;
      case 'pct_asc': sorted.sort((a, b) => a.p.pctPaidIn - b.p.pctPaidIn); break;
      case 'balance_desc': sorted.sort((a, b) => b.p.remainingBalance - a.p.remainingBalance); break;
      case 'funded_desc': sorted.sort((a, b) => b.p.fundedAmount - a.p.fundedAmount); break;
      default: sorted.sort((a, b) => (new Date(b.deal.fundingDate ?? 0).getTime()) - (new Date(a.deal.fundingDate ?? 0).getTime()));
    }
    // Push deals without structure to the bottom of any non-pct sort so the
    // populated ones still lead the page.
    sorted.sort((a, b) => Number(b.p.hasStructure) - Number(a.p.hasStructure));
    return sorted;
  }, [enriched, view, search, sort]);

  // Portfolio totals
  const totals = useMemo(() => {
    let funded = 0, payback = 0, collected = 0, remaining = 0, refi = 0;
    for (const e of enriched) {
      if (!e.p.hasStructure) continue;
      funded += e.p.fundedAmount; payback += e.p.totalPayback;
      collected += e.p.amountCollected; remaining += e.p.remainingBalance;
      if (e.p.renewalEligible) refi++;
    }
    return { funded, payback, collected, remaining, refi, count: enriched.filter((e) => e.p.hasStructure).length };
  }, [enriched]);

  return (
    <div className="space-y-5">
      <PageHeader title="Funded Deals" description="Live view of every funded deal — balance, paydown, and renewal status update automatically." />

      {/* Portfolio totals */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Active deals" value={String(totals.count)} />
        <Stat label="Funded volume" value={formatCurrency(totals.funded, { compact: true })} />
        <Stat label="Collected" value={formatCurrency(totals.collected, { compact: true })} tone="emerald" />
        <Stat label="Outstanding" value={formatCurrency(totals.remaining, { compact: true })} tone="amber" />
        <Stat label="Refi ready" value={String(totals.refi)} tone="teal" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {([['all', 'All'], ['paying', 'Paying down'], ['refi', 'Refi ready']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={cn('px-3 py-1.5 rounded-full border text-xs font-medium transition',
              view === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-8 rounded-full border border-input bg-card px-3 text-xs text-muted-foreground">
          <option value="recent">Newest funded</option>
          <option value="pct_desc">Most paid down</option>
          <option value="pct_asc">Least paid down</option>
          <option value="balance_desc">Highest balance</option>
          <option value="funded_desc">Largest funded</option>
        </select>
        <div className="ml-auto relative w-full sm:w-auto sm:min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deals or merchants…" className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : portfolio.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          No funded deals yet. When a deal in Active Deals is marked &quot;Funded,&quot; it appears here.
        </CardContent></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="w-8 px-2 py-2"></th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Deal</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Status</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 hidden md:table-cell">Funded</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Funded $</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 hidden lg:table-cell">Payback $</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 hidden lg:table-cell">Term</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 w-40">% Paid</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Balance</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 hidden xl:table-cell">Renewal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {portfolio.map(({ deal, p }) => (
                <FundedDealRow
                  key={deal.id}
                  deal={deal}
                  p={p}
                  onUpdated={(patched) => {
                    setDeals((arr) => arr.map((d) => d.id === deal.id ? { ...d, ...patched } : d));
                  }}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'teal' }) {
  const color = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : tone === 'teal' ? 'text-teal-700' : 'text-foreground';
  return (
    <Card><CardContent className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={cn('text-xl font-semibold tabular-nums mt-1', color)}>{value}</div>
    </CardContent></Card>
  );
}

/**
 * Funded-deal card. Two modes:
 *
 *   • Tracker mode  — when the deal has full paydown structure (funded amount,
 *     factor, term, fundingDate). Shows the live paydown tracker with progress
 *     bar, balance, refi eligibility, etc. Edit button toggles into editor mode.
 *
 *   • Editor mode   — for cards without complete paydown info AND when the
 *     user clicks Edit. Inputs for: funded amount, fee %, factor, term type +
 *     count, funding date, amount collected. Save persists via PATCH /api/deals/:id.
 *
 * Funding-detail entry only lives here on Funded Deals — Active Deals no
 * longer has these fields per the spec.
 */
/**
 * Funded-deal table row + expand panel.
 *
 * Layout follows the syndication-style dense table the user supplied:
 * collapsed row shows the high-signal columns (deal, status, funded date,
 * funded $, payback $, term, % paid with progress bar, balance, renewal
 * badge). Click the row to expand for full details + editor.
 *
 * Two expand-panel modes:
 *
 *   • Detail mode  — when the deal has full paydown structure (funded
 *     amount, factor, term, fundingDate). Shows the live paydown breakdown
 *     (payments, payoff date, daily/weekly payment amount, refi eligibility)
 *     plus an Edit button to switch to editor mode.
 *
 *   • Editor mode  — for cards without complete paydown info, OR when the
 *     user clicks Edit. Inputs for: funded amount, fee %, factor, term mode
 *     + count, funding date, amount collected. Save persists via PATCH
 *     /api/deals/:id.
 *
 * Funding-detail entry only lives here on Funded Deals — Active Deals no
 * longer has these fields per the spec.
 */
function FundedDealRow({
  deal,
  p,
  onUpdated,
}: {
  deal: Deal;
  p: ReturnType<typeof computePaydown>;
  onUpdated: (patch: Partial<Deal>) => void;
}) {
  const m = DEAL_STATUS_META[deal.status] ?? { label: deal.status, tone: 'gray' };
  const merchant = `${deal.merchantFirstName ?? ''} ${deal.merchantLastName ?? ''}`.trim();

  // Auto-expand cards that don't have a paydown structure yet so the user
  // immediately sees the editor prompt and can fill in the funding details
  // (otherwise the row looks normal but offers nothing useful).
  const [expanded, setExpanded] = useState(!p.hasStructure);
  const [editing, setEditing] = useState(!p.hasStructure);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    fundedAmount: deal.fundedAmount ?? '',
    feePct: deal.feePct ?? '',
    factorRate: deal.factorRate ?? '',
    termMode: deal.termMode ?? 'weekly',
    termCount: deal.termCount ?? '',
    fundingDate: deal.fundingDate ? String(deal.fundingDate).slice(0, 10) : '',
    amountCollected: deal.amountCollected ?? '',
  });

  async function save() {
    setSaving(true);
    const body: Record<string, unknown> = { ...draft };
    for (const k of ['fundedAmount', 'feePct', 'factorRate', 'termCount', 'amountCollected'] as const) {
      if (body[k] === '') body[k] = null;
    }
    if (body.fundingDate === '') body.fundingDate = null;
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      onUpdated(body as Partial<Deal>);
      setEditing(false);
    }
  }

  // % Paid bar color — green when refi eligible, blue otherwise, gray if
  // no structure (shows as empty bar so the column doesn't look broken).
  const pctColor = !p.hasStructure ? 'bg-muted-foreground/20'
    : p.renewalEligible ? 'bg-teal-500'
    : 'bg-primary';

  // Display values — fall back to em-dash for missing/unstructured cells so
  // the table doesn't render literal "NaN" or "$0" for a deal that hasn't
  // had its funding details entered yet.
  const fundedDisplay = p.hasStructure ? formatCurrency(p.fundedAmount, { compact: true }) : '—';
  const paybackDisplay = p.hasStructure ? formatCurrency(p.totalPayback, { compact: true }) : '—';
  const balanceDisplay = p.hasStructure ? formatCurrency(p.remainingBalance, { compact: true }) : '—';
  const termDisplay = p.hasStructure
    ? `${p.termCount} ${p.termMode === 'daily' ? 'd' : 'w'}`
    : '—';
  const fundedDateDisplay = p.fundingDate
    ? p.fundingDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
    : '—';
  const pctText = p.hasStructure ? `${p.pctPaidIn.toFixed(1)}%` : '—';

  return (
    <>
      <tr
        className={cn('transition-colors cursor-pointer',
          expanded ? 'bg-muted/40' : 'hover:bg-muted/30',
          !p.hasStructure && 'bg-amber-50/40'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-2 py-2 text-muted-foreground text-center text-xs">
          {expanded ? '▾' : '▸'}
        </td>
        <td className="px-3 py-2 min-w-[180px]">
          <div className="font-medium truncate">{deal.name}</div>
          {merchant && <div className="text-[11px] text-muted-foreground truncate">{merchant}</div>}
        </td>
        <td className="px-3 py-2">
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap', TONE_CLASS[m.tone] ?? TONE_CLASS.gray)}>
            {m.label}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap hidden md:table-cell">
          {fundedDateDisplay}
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap">{fundedDisplay}</td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground whitespace-nowrap hidden lg:table-cell">{paybackDisplay}</td>
        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground text-xs whitespace-nowrap hidden lg:table-cell">{termDisplay}</td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[60px]">
              <div className={cn('h-full rounded-full transition-all', pctColor)} style={{ width: `${Math.min(100, p.pctPaidIn)}%` }} />
            </div>
            <span className={cn('text-xs tabular-nums font-medium w-12 text-right', p.renewalEligible && 'text-teal-700')}>{pctText}</span>
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{balanceDisplay}</td>
        <td className="px-3 py-2 hidden xl:table-cell">
          {p.renewalEligible
            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-100 text-teal-800 border border-teal-200">Refi ready</span>
            : p.renewalDate
              ? <span className="text-[11px] text-muted-foreground tabular-nums">{p.renewalDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              : <span className="text-[11px] text-muted-foreground">—</span>}
        </td>
      </tr>

      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={10} className="px-4 py-4">
            <div className="space-y-3">
              {!editing && p.hasStructure && (
                <>
                  {/* Detail panel — grid of high-detail fields that don't fit
                      in the collapsed row. Echoes the syndication-style columns
                      the user mentioned (principal, payback, payoff date,
                      payment amount/frequency, etc). */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <Detail label="Funded amount" value={formatCurrency(p.fundedAmount)} />
                    <Detail label="Factor rate" value={p.factorRate.toFixed(3)} />
                    <Detail label="Total payback" value={formatCurrency(p.totalPayback)} />
                    <Detail label="Amount collected" value={formatCurrency(p.amountCollected)} />
                    <Detail label="Remaining balance" value={formatCurrency(p.remainingBalance)} />
                    <Detail
                      label={p.termMode === 'daily' ? 'Daily payment' : 'Weekly payment'}
                      value={formatCurrency(p.paymentAmount)}
                    />
                    <Detail
                      label="Payments made"
                      value={`${p.paymentsMade} / ${p.paymentsTotal}`}
                    />
                    <Detail
                      label="Est. payoff"
                      value={p.payoffDate ? p.payoffDate.toLocaleDateString() : '—'}
                    />
                    <Detail
                      label="% Paid in"
                      value={`${p.pctPaidIn.toFixed(2)}%`}
                      tone={p.renewalEligible ? 'teal' : undefined}
                    />
                    <Detail
                      label="Renewal eligibility"
                      value={p.renewalEligible
                        ? 'Eligible now'
                        : p.renewalDate
                          ? `~${p.renewalDate.toLocaleDateString()}`
                          : '—'}
                      tone={p.renewalEligible ? 'teal' : undefined}
                    />
                    <Detail
                      label="Funded date"
                      value={p.fundingDate ? p.fundingDate.toLocaleDateString() : '—'}
                    />
                    <Detail
                      label="Term"
                      value={`${p.termCount} ${p.termMode === 'daily' ? 'business days' : 'weeks'}`}
                    />
                  </div>
                  <div className="flex justify-end">
                    <button onClick={() => setEditing(true)} className="text-xs font-medium text-primary hover:underline">
                      Edit funding details
                    </button>
                  </div>
                </>
              )}

              {!editing && !p.hasStructure && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Funding details not entered yet. <button onClick={() => setEditing(true)} className="font-semibold underline">Add them</button> to enable paydown tracking.
                </div>
              )}

              {editing && (
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Funding details</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    <Field label="Funded amount ($)">
                      <Input inputMode="decimal" value={String(draft.fundedAmount ?? '')} onChange={(e) => setDraft({ ...draft, fundedAmount: e.target.value })} placeholder="50000" />
                    </Field>
                    <Field label="Fee (%)">
                      <Input inputMode="decimal" value={String(draft.feePct ?? '')} onChange={(e) => setDraft({ ...draft, feePct: e.target.value })} placeholder="5" />
                    </Field>
                    <Field label="Factor rate">
                      <Input inputMode="decimal" value={String(draft.factorRate ?? '')} onChange={(e) => setDraft({ ...draft, factorRate: e.target.value })} placeholder="1.40" />
                    </Field>
                    <Field label="Term type">
                      <select value={draft.termMode ?? 'weekly'} onChange={(e) => setDraft({ ...draft, termMode: e.target.value })} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm">
                        <option value="weekly">Weekly</option>
                        <option value="daily">Daily</option>
                      </select>
                    </Field>
                    <Field label="# of payments">
                      <Input inputMode="numeric" value={String(draft.termCount ?? '')} onChange={(e) => setDraft({ ...draft, termCount: e.target.value })} placeholder="26" />
                    </Field>
                    <Field label="Funding date">
                      <Input type="date" value={draft.fundingDate ?? ''} onChange={(e) => setDraft({ ...draft, fundingDate: e.target.value })} />
                    </Field>
                    <Field label="Amount collected ($)">
                      <Input inputMode="decimal" value={String(draft.amountCollected ?? '')} onChange={(e) => setDraft({ ...draft, amountCollected: e.target.value })} placeholder="auto if blank" />
                    </Field>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    {p.hasStructure && (
                      <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                    )}
                    <button
                      onClick={save}
                      disabled={saving}
                      className="h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Small label/value pair used in the funded-deal expand detail grid. */
function Detail({ label, value, tone }: { label: string; value: string; tone?: 'teal' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={cn('tabular-nums font-medium mt-0.5', tone === 'teal' ? 'text-teal-700' : 'text-foreground')}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
