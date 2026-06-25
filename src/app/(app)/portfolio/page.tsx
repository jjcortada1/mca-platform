'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, PageHeader, Input, Button, CurrencyInput, PercentInput } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Search, Trash2, Plus, LayoutGrid, List as ListIcon } from 'lucide-react';
import { computePaydown } from '@/lib/deals/paydown';
import { formatCalendarDate, toDateInput } from '@/lib/dates';

interface Deal {
  id: string;
  name: string;
  merchantFirstName: string | null;
  merchantLastName: string | null;
  // Extended merchant + business fields — surfaced in the full-detail expand.
  // All optional / nullable so the type stays compatible with legacy rows.
  merchantPhone?: string | null;
  merchantEmail?: string | null;
  businessName?: string | null;
  businessAddress?: string | null;
  businessCity?: string | null;
  businessState?: string | null;
  businessZip?: string | null;
  industry?: string | null;
  status: string;
  fundedAmount: string | null;
  feePct: string | null;
  factorRate: string | null;
  termMode: string | null;
  termCount: string | null;
  fundingDate: string | null;
  amountCollected: string | null;
  assignedRepId: string | null;
  assignedRepName?: string | null;
  // Funded-deal sub-status. Null/missing → treated as 'active' in UI.
  fundedSubStatus?: 'active' | 'refi_eligible' | 'payment_issues' | 'default' | 'refinanced' | null;
  // Which funder ultimately funded this deal. Either an FK to a directory
  // funder OR a free-text label (the funder isn't in the directory).
  fundedWithFunderId?: string | null;
  fundedWithName?: string | null;
  // General-purpose notes on this funded deal — surfaced here AND in the
  // rep commission view so reps have deal context alongside their pay.
  fundedNotes?: string | null;
  // Paid-off tracking (schema fields). When the deal has been closed out
  // — either by payoff or by being rolled into a refi — paidOff is true.
  // paidOffAmount captures the actual settled amount, which can differ
  // from the contracted totalPayback (early-payoff discount, etc).
  paidOff?: boolean | null;
  paidOffAmount?: string | null;
  paidOffDate?: string | null;
  /**
   * Refi linkage — when this deal is itself a refinance OF another deal,
   * `renewalOfDealId` points at the original. Added so the audit chain
   * old→new survives even after the old deal is closed out.
   * Set when the "Mark as refinanced" flow creates the new deal.
   */
  renewalOfDealId?: string | null;
  // Free-text fields displayed in the expand panel.
  notes?: string | null;
  renewalNotes?: string | null;
  // Audit timestamps — surfaced as "Created" / "Updated" in the detail grid.
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** Sub-status labels + tones for the Funded Deals table. */
const FUNDED_SUB_STATUS: Record<string, { label: string; tone: string }> = {
  active:         { label: 'Active',          tone: 'emerald' },
  refi_eligible:  { label: 'Refi Eligible',   tone: 'teal' },
  payment_issues: { label: 'Payment Issues',  tone: 'amber' },
  default:        { label: 'Default',         tone: 'red' },
  // 'refinanced' — terminal state set by the "Mark as refinanced" flow.
  // Intentionally NOT in the user-facing dropdown options so it can only
  // be reached via the explicit Mark-as-refinanced action (which also
  // forces 100% paid in + opens a new deal form for the refi).
  refinanced:     { label: 'Refinanced',      tone: 'violet' },
};

const TONE_CLASS: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-800 border-amber-200', blue: 'bg-blue-100 text-blue-800 border-blue-200',
  gray: 'bg-gray-100 text-gray-700 border-gray-200', slate: 'bg-slate-100 text-slate-700 border-slate-200',
  violet: 'bg-violet-100 text-violet-800 border-violet-200', emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  rose: 'bg-rose-100 text-rose-800 border-rose-200', red: 'bg-red-100 text-red-800 border-red-200',
  orange: 'bg-orange-100 text-orange-800 border-orange-200', teal: 'bg-teal-100 text-teal-800 border-teal-200',
  cyan: 'bg-cyan-100 text-cyan-800 border-cyan-200',
};

type SortKey = 'recent' | 'oldest' | 'pct_desc' | 'pct_asc' | 'balance_desc' | 'funded_desc';

export default function PortfolioPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'all' | 'paying' | 'refi'>('all');
  const [sort, setSort] = useState<SortKey>('recent');
  // Roster for the rep-assignment dropdown on each funded deal row.
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  // Funder directory for the "Funded With" picker on the funded-deal editor.
  const [funders, setFunders] = useState<{ id: string; name: string }[]>([]);
  // Delete confirmation state. When non-null, the ConfirmDialog renders and
  // the user can review the action before destruction. Reusable component
  // replaces native browser confirm() so the dialog doesn't appear in the
  // browser chrome at the top of the page.
  const [deleting, setDeleting] = useState<{ dealId: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Current user — used to enforce the "reps only see their own funded deals"
  // rule on the client side (the server enforces it independently). Admins
  // get a Rep filter dropdown that lets them slice the list by any rep.
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const isAdmin = me?.role === 'master_admin' || me?.role === 'company_admin';
  // Admin's rep filter: '' = all, 'mine' = current user, else specific repId.
  const [repFilter, setRepFilter] = useState<string>('');

  // "Add funded deal" drawer state. Lives in this top-level component so the
  // drawer survives table re-renders.
  const [showAdd, setShowAdd] = useState(false);

  // List vs Card layout. Defaults to 'list' — the existing table view that
  // admins have been using since the beginning. Card view is opt-in and
  // remembered across visits so users who prefer it don't have to flip
  // every time. Persistence is best-effort; SSR-safe (window guard).
  const [viewMode, setViewMode] = useState<'list' | 'card'>(() => {
    if (typeof window === 'undefined') return 'list';
    return (localStorage.getItem('mca-portfolio-view') as 'list' | 'card') ?? 'list';
  });
  useEffect(() => {
    try { localStorage.setItem('mca-portfolio-view', viewMode); } catch {}
  }, [viewMode]);

  // When a card is clicked, we flip to list view AND auto-expand the
  // corresponding row so the user lands directly on the editor. This keeps
  // ALL editing functionality on the existing FundedDealRow (no duplication
  // of complex edit logic into the card component, and no risk of the two
  // editors drifting apart). The id is consumed by FundedDealRow once
  // mounted, then cleared so future row interactions aren't forced open.
  const [autoExpandId, setAutoExpandId] = useState<string | null>(null);
  useEffect(() => {
    if (autoExpandId && viewMode === 'list') {
      // Scroll the row into view after the layout switches. RAF gives the
      // DOM one paint to render the list before we go looking for the row.
      requestAnimationFrame(() => {
        const el = document.getElementById(`funded-row-${autoExpandId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [autoExpandId, viewMode]);

  useEffect(() => {
    // Load current user FIRST so we know whether to send `?mine=1`. We don't
    // actually need to wait — the server enforces the rep scoping by role —
    // but sending the param keeps the network trace explicit.
    fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (j?.user) setMe({ id: j.user.id, role: j.user.role });
    }).catch(() => {});

    fetch('/api/deals', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      setDeals((j.data ?? j.deals ?? []) as Deal[]);
    }).catch(() => {}).finally(() => setLoading(false));

    // Load company users so the rep-assignment dropdown has the full roster.
    // Lead-source accounts excluded (they own deals via leadSourceId).
    fetch('/api/users', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      const list = (j.data ?? j.users ?? []) as { id: string; name: string | null; email: string; role: string }[];
      setReps(list
        .filter((u) => u.role !== 'lead_source')
        .map((u) => ({ id: u.id, name: u.name || u.email }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {});

    // Funder directory for the "Funded With" dropdown on each funded-deal
    // editor + the add-funded-deal drawer. We want active funders only
    // (and the response is already filtered to !isDeleted on the server).
    fetch('/api/funders', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      const list = (j.data ?? j.funders ?? []) as { id: string; name: string; isActive?: boolean }[];
      setFunders(list
        .filter((f) => f.isActive !== false)
        .map((f) => ({ id: f.id, name: f.name }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {});
  }, []);

  async function performDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    const res = await fetch(`/api/deals/${deleting.dealId}`, { method: 'DELETE' });
    setDeleteLoading(false);
    if (res.ok) {
      // Optimistic remove from local state so the row disappears immediately.
      setDeals((arr) => arr.filter((d) => d.id !== deleting.dealId));
      setDeleting(null);
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error || 'Could not delete this deal.');
    }
  }

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
        // Refinanced deals are terminal — short-circuit renewalEligible so
        // they stop appearing in the refi-ready filter on /portfolio.
        fundedSubStatus: d.fundedSubStatus,
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

    // Rep filter:
    //   • Non-admin: hard-scoped to their own deals (defense in depth on top
    //     of the server-side filter — keeps any cached list private).
    //   • Admin with repFilter='mine': scope to admin's own deals.
    //   • Admin with repFilter=<repId>: scope to that rep.
    //   • Admin with empty repFilter: all funded deals.
    if (me && !isAdmin) {
      list = list.filter((e) => e.deal.assignedRepId === me.id);
    } else if (isAdmin && me && repFilter === 'mine') {
      list = list.filter((e) => e.deal.assignedRepId === me.id);
    } else if (isAdmin && repFilter && repFilter !== 'mine') {
      list = list.filter((e) => e.deal.assignedRepId === repFilter);
    }

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
      // 'oldest' = ascending funding date (earliest first). 'recent' is the
      // descending default — newest funded first.
      case 'oldest': sorted.sort((a, b) => (new Date(a.deal.fundingDate ?? 0).getTime()) - (new Date(b.deal.fundingDate ?? 0).getTime())); break;
      default: sorted.sort((a, b) => (new Date(b.deal.fundingDate ?? 0).getTime()) - (new Date(a.deal.fundingDate ?? 0).getTime()));
    }
    // Push deals without structure to the bottom of any non-pct sort so the
    // populated ones still lead the page.
    sorted.sort((a, b) => Number(b.p.hasStructure) - Number(a.p.hasStructure));
    return sorted;
  }, [enriched, view, search, sort, me, isAdmin, repFilter]);

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

  /**
   * Sub-status breakdown for the dashboard pie chart.
   *
   * Categories:
   *   • Active        — paying normally (default state, fundedSubStatus
   *                     null/'active' AND not refi-eligible)
   *   • Refi ready    — 50%+ paid in, eligible for renewal
   *   • Payment issues
   *   • Default
   *   • Paid off      — closed via direct payoff (paidOff=true and NOT
   *                     refinanced)
   *   • Refinanced    — rolled into a new deal
   *
   * Counts only deals with enough structure to compute paydown (skips
   * back-fill rows that haven't had funding details entered yet).
   */
  const breakdown = useMemo(() => {
    const buckets = {
      active: 0,
      refi_eligible: 0,
      payment_issues: 0,
      default: 0,
      paid_off: 0,
      refinanced: 0,
    };
    for (const e of enriched) {
      if (!e.p.hasStructure) continue;
      const ss = e.deal.fundedSubStatus ?? 'active';
      if (ss === 'refinanced') buckets.refinanced++;
      else if (e.deal.paidOff) buckets.paid_off++;
      else if (ss === 'payment_issues') buckets.payment_issues++;
      else if (ss === 'default') buckets.default++;
      else if (e.p.renewalEligible) buckets.refi_eligible++;
      else buckets.active++;
    }
    return buckets;
  }, [enriched]);

  /**
   * Month-over-month funded volume for the bar chart.
   *
   * Returns the last 12 months including the current one — even months
   * with zero funded volume are present so the bar chart shows a
   * continuous timeline. Months keyed by YYYY-MM so they sort lexically.
   */
  const monthly = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string; volume: number; count: number }[] = [];
    // Build the 12-slot window first; we fill the volumes in afterward.
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-US', { month: 'short' });
      months.push({ key, label, volume: 0, count: 0 });
    }
    const byKey = new Map(months.map((m) => [m.key, m]));
    for (const e of enriched) {
      if (!e.p.hasStructure || !e.p.fundingDate) continue;
      const fd = e.p.fundingDate;
      const key = `${fd.getFullYear()}-${String(fd.getMonth() + 1).padStart(2, '0')}`;
      const bucket = byKey.get(key);
      if (!bucket) continue;
      bucket.volume += e.p.fundedAmount;
      bucket.count++;
    }
    return months;
  }, [enriched]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Funded Deals"
        description="Live view of every funded deal — balance, paydown, and renewal status update automatically."
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1">
            <Plus className="h-4 w-4" />
            Add funded deal
          </Button>
        }
      />

      {/* Portfolio totals */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Active deals" value={String(totals.count)} />
        <Stat label="Funded volume" value={formatCurrency(totals.funded, { compact: true })} />
        <Stat label="Collected" value={formatCurrency(totals.collected, { compact: true })} tone="emerald" />
        <Stat label="Outstanding" value={formatCurrency(totals.remaining, { compact: true })} tone="amber" />
        <Stat label="Refi ready" value={String(totals.refi)} tone="teal" />
      </div>

      {/* Funded Deals dashboard — visualizes the deal-status breakdown and
          month-over-month funding volume so admins can see at a glance
          what the portfolio looks like + how funding is trending.
          Hidden when there are no funded deals (the empty state below
          covers that case more usefully). */}
      {totals.count > 0 && (
        <PortfolioDashboard breakdown={breakdown} monthly={monthly} totals={totals} />
      )}

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
          <option value="oldest">Oldest funded</option>
          <option value="pct_desc">Most paid down</option>
          <option value="pct_asc">Least paid down</option>
          <option value="balance_desc">Highest balance</option>
          <option value="funded_desc">Largest funded</option>
        </select>
        {/* Rep filter — admin-only. Reps see only their own deals (forced
            both server-side and client-side) so the dropdown is hidden. */}
        {isAdmin && (
          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            className="h-8 rounded-full border border-input bg-card px-3 text-xs text-muted-foreground max-w-[180px]"
            title="Filter funded deals by rep"
          >
            <option value="">All reps</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2 w-full sm:w-auto">
          {/* List ↔ Card view toggle. Default is the existing list/table
              view (item 4 — "default should be like the list view the way
              it is now"). Card view is a richer visual layout showing the
              same funded-deal data per card with a paydown progress bar. */}
          <div className="inline-flex rounded-md border border-input bg-card p-0.5 shrink-0" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={cn(
                'h-8 px-2.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5',
                viewMode === 'list' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              title="List view"
              aria-pressed={viewMode === 'list'}
            >
              <ListIcon className="h-3.5 w-3.5" />
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('card')}
              className={cn(
                'h-8 px-2.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5',
                viewMode === 'card' ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              title="Card view"
              aria-pressed={viewMode === 'card'}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Cards
            </button>
          </div>
          <div className="relative flex-1 sm:flex-initial sm:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deals or merchants…" className="pl-9" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : portfolio.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          No funded deals yet. When a deal in Active Deals is marked &quot;Funded,&quot; it appears here.
        </CardContent></Card>
      ) : viewMode === 'list' ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="w-8 px-2 py-2"></th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Deal</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Status</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 hidden md:table-cell">
                  {/* Click to toggle Date Funded sort:
                      first click  → newest first (recent)
                      second click → oldest first (oldest)
                      Visual chevron reflects the current direction. */}
                  <button
                    type="button"
                    onClick={() => setSort(sort === 'recent' ? 'oldest' : 'recent')}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    title="Sort by funded date"
                  >
                    Funded
                    {sort === 'recent' && <span className="text-foreground">↓</span>}
                    {sort === 'oldest' && <span className="text-foreground">↑</span>}
                  </button>
                </th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Funded $</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 hidden lg:table-cell">Payback $</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 hidden lg:table-cell">Term</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 w-40">% Paid</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">Balance</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 hidden xl:table-cell">Renewal</th>
                <th className="w-10 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {portfolio.map(({ deal, p }) => (
                <FundedDealRow
                  key={deal.id}
                  deal={deal}
                  p={p}
                  reps={reps}
                  funders={funders}
                  forceExpand={autoExpandId === deal.id}
                  onUpdated={(patched) => {
                    setDeals((arr) => arr.map((d) => d.id === deal.id ? { ...d, ...patched } : d));
                  }}
                  onRequestDelete={() => setDeleting({ dealId: deal.id, name: deal.name })}
                />
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        // ── CARD VIEW ────────────────────────────────────────────────
        // Grid of funded-deal cards. Each shows the same data as the list
        // row (deal name, merchant, status, funded $, paydown %, balance)
        // but in a richer visual layout with a paydown progress bar.
        // Clicking a card jumps to list view with that row expanded —
        // editing logic lives ONLY on FundedDealRow so the two views never
        // drift apart and there's only one place to change deal-editing
        // behavior.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {portfolio.map(({ deal, p }) => (
            <FundedDealCard
              key={deal.id}
              deal={deal}
              p={p}
              onOpen={() => {
                setAutoExpandId(deal.id);
                setViewMode('list');
              }}
            />
          ))}
        </div>
      )}

      {/* Centered confirmation modal — replaces native browser confirm() so
          destructive flows live in-page instead of a top-of-browser popup. */}
      <ConfirmDialog
        open={!!deleting}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="This permanently removes the funded deal and all of its submissions, commissions, and history. The action cannot be undone."
        confirmLabel="Delete deal"
        destructive
        loading={deleteLoading}
        onConfirm={performDelete}
        onCancel={() => !deleteLoading && setDeleting(null)}
      />

      {/* Add-funded-deal drawer — creates a new deal with status='funded'
          and pre-filled funding details so it shows up here immediately. */}
      {showAdd && (
        <AddFundedDealDrawer
          reps={reps}
          funders={funders}
          onClose={() => setShowAdd(false)}
          onCreated={(d) => {
            setDeals((arr) => [d, ...arr]);
            setShowAdd(false);
          }}
        />
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
  reps,
  funders,
  forceExpand,
  onUpdated,
  onRequestDelete,
}: {
  deal: Deal;
  p: ReturnType<typeof computePaydown>;
  reps: { id: string; name: string }[];
  funders: { id: string; name: string }[];
  /**
   * When true (set by the card-view click handler), force the row open on
   * mount so the user lands directly on the editor. The local `expanded`
   * state still owns subsequent toggles after that.
   */
  forceExpand?: boolean;
  onUpdated: (patch: Partial<Deal>) => void;
  onRequestDelete: () => void;
}) {
  // Funded sub-status drives the badge instead of the broad deal.status when
  // we're on the Funded Deals page (every row here is funded by definition,
  // so showing "Funded" doesn't add information). Falls back to 'active' for
  // legacy rows that have no sub-status set yet.
  const subStatusKey = deal.fundedSubStatus ?? 'active';
  const subMeta = FUNDED_SUB_STATUS[subStatusKey] ?? FUNDED_SUB_STATUS.active;
  const merchant = `${deal.merchantFirstName ?? ''} ${deal.merchantLastName ?? ''}`.trim();

  // Auto-expand cards that don't have a paydown structure yet so the user
  // immediately sees the editor prompt and can fill in the funding details
  // (otherwise the row looks normal but offers nothing useful).
  // Also auto-expand when forceExpand is true (card view → list view jump).
  const [expanded, setExpanded] = useState(!p.hasStructure || !!forceExpand);
  // React to forceExpand changes after mount — the card-view handler may
  // re-target the same row twice (set autoExpandId twice in a row), and we
  // want the row to re-open even if the user collapsed it in between.
  useEffect(() => {
    if (forceExpand) setExpanded(true);
  }, [forceExpand]);
  const [editing, setEditing] = useState(!p.hasStructure);
  const [saving, setSaving] = useState(false);
  // Refi flow state — kicks in when admin clicks "Mark as refinanced".
  // Confirmation dialog asks for an optional payoff amount (sometimes the
  // refi proceeds differ from the contracted balance — discount, etc),
  // then patches the old deal (paid off + 100% collected + sub-status
  // 'refinanced') and routes the user to /active-deals where the new
  // deal form opens pre-filled with the merchant's contact info.
  const [refiOpen, setRefiOpen] = useState(false);
  const [refiPayoff, setRefiPayoff] = useState<string>('');
  const [refiSaving, setRefiSaving] = useState(false);
  const router = useRouter();

  /**
   * Mark the deal as refinanced.
   *
   * Steps:
   *   1. Compute the contracted total payback (fundedAmount × factorRate)
   *      and patch the old deal: amountCollected = totalPayback (100% paid
   *      in), fundedSubStatus = 'refinanced'.
   *   2. Stash the merchant pre-fill (name, phone, email, business) in
   *      sessionStorage so /active-deals can read it and open the create
   *      drawer with those fields populated.
   *   3. Navigate to /active-deals?refi=1 — the page reads the sessionStorage
   *      payload on mount, then clears it so a subsequent refresh doesn't
   *      re-open the drawer.
   *
   * No new endpoints, no schema changes — uses the existing PATCH route
   * and the existing /active-deals create drawer.
   */
  async function markRefinanced() {
    // Hard guard against double-mark: if the deal is already refinanced
    // OR if a previous mark request is still in flight, bail. The button
    // is also hidden in the UI when subStatusKey === 'refinanced', but
    // this is the defense-in-depth check that protects against fast
    // double-clicks (button hidden between clicks but not yet aware of
    // the state change in the async window).
    if (subStatusKey === 'refinanced') {
      setRefiOpen(false);
      return;
    }
    if (refiSaving) return;
    setRefiSaving(true);
    const funded = Number(deal.fundedAmount ?? 0);
    const factor = Number(deal.factorRate ?? 0);
    const totalPayback = funded > 0 && factor > 0 ? funded * factor : Number(p.totalPayback) || 0;
    const body: Record<string, unknown> = {
      // 100% paid in. Keep the deal record's amountCollected synced with the
      // contracted totalPayback so the paydown tracker shows the bar full.
      amountCollected: totalPayback || null,
      fundedSubStatus: 'refinanced',
    };
    // If the user entered an explicit payoff amount (e.g. discounted) we
    // store it in renewalNotes for now — schema doesn't have a dedicated
    // refi-payoff field and this preserves the actual settled number for
    // audit. Format: "Refi payoff: $X,XXX.XX on YYYY-MM-DD"
    if (refiPayoff && Number(refiPayoff) > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const note = `Refi payoff: $${Number(refiPayoff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on ${today}`;
      body.renewalNotes = deal.renewalNotes ? `${deal.renewalNotes}\n${note}` : note;
    }
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setRefiSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || 'Could not mark deal as refinanced.');
      return;
    }
    // Optimistic local update so the row reflects the new state immediately,
    // even before the parent's list refetches.
    onUpdated({
      amountCollected: totalPayback ? String(totalPayback) : deal.amountCollected,
      fundedSubStatus: 'refinanced',
      renewalNotes: body.renewalNotes as string | undefined ?? deal.renewalNotes,
    });
    // Stash pre-fill blob for /active-deals to pick up. Keys are flat so
    // the consumer doesn't need to know the structure ahead of time.
    try {
      const prefill = {
        sourceDealId: deal.id,
        sourceDealName: deal.name,
        merchantFirstName: deal.merchantFirstName ?? '',
        merchantLastName: deal.merchantLastName ?? '',
        merchantPhone: deal.merchantPhone ?? '',
        merchantEmail: deal.merchantEmail ?? '',
        businessName: deal.businessName ?? '',
        businessAddress: deal.businessAddress ?? '',
        businessCity: deal.businessCity ?? '',
        businessState: deal.businessState ?? '',
        businessZip: deal.businessZip ?? '',
        industry: deal.industry ?? '',
      };
      sessionStorage.setItem('mca-refi-prefill', JSON.stringify(prefill));
    } catch {
      // SessionStorage unavailable (private mode, etc) — silently skip
      // and the user can paste merchant info manually.
    }
    setRefiOpen(false);
    router.push('/active-deals?refi=1');
  }
  const [draft, setDraft] = useState<{
    fundedAmount: string;
    feePct: string;
    factorRate: string;
    termMode: string;
    termCount: string;
    fundingDate: string;
    amountCollected: string;
    // Draft can hold ALL possible sub-statuses including 'refinanced'.
    // The dropdown options only expose the 4 editable ones; refinanced is
    // a terminal state, never user-selectable.
    fundedSubStatus: 'active' | 'refi_eligible' | 'payment_issues' | 'default' | 'refinanced';
    assignedRepId: string;
    fundedWithFunderId: string | null;
    fundedNotes: string;
  }>({
    fundedAmount: deal.fundedAmount ?? '',
    feePct: deal.feePct ?? '',
    factorRate: deal.factorRate ?? '',
    termMode: deal.termMode ?? 'weekly',
    termCount: deal.termCount ?? '',
    fundingDate: deal.fundingDate ? String(deal.fundingDate).slice(0, 10) : '',
    amountCollected: deal.amountCollected ?? '',
    // Sub-status + rep editable from the same form as funding details so
    // the user can change everything in one save round-trip. We accept the
    // full 5-value union here — if the deal is already 'refinanced' the
    // editor will still show that state read-only (the dropdown is
    // hidden for refinanced deals).
    fundedSubStatus: subStatusKey,
    assignedRepId: deal.assignedRepId ?? '',
    // Funded With + Notes — surfaced in the editor, persisted to the
    // deals row, exposed in commissions for reps.
    fundedWithFunderId: deal.fundedWithFunderId ?? null,
    fundedNotes: deal.fundedNotes ?? '',
  });

  // Pending-confirm state — when set, a ConfirmDialog asks the user
  // to verify before the change is applied. Covers status changes,
  // rep reassignments, and save-funding-details — the actions that
  // make a real state change to a funded deal. Each variant stashes
  // just enough info for the confirm handler to fire the actual write.
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: 'subStatus'; next: 'active' | 'refi_eligible' | 'payment_issues' | 'default' | 'refinanced' }
    | { kind: 'rep'; repId: string }
    | { kind: 'save' }
    | null
  >(null);

  // Inline sub-status changer — small select on the table row that PATCHes
  // immediately so the user doesn't need to expand the row to update it.
  // Accepts 'refinanced' from the dropdown directly too: per spec, the
  // status itself is editable. The Mark-as-refinanced BUTTON elsewhere
  // is a separate action that ALSO opens the new-deal pre-fill flow;
  // setting the status from the dropdown only changes the label.
  // ALWAYS prompts for confirmation before applying — funded-deal status
  // changes are consequential (drive refi-eligibility, commissions,
  // celebration), so the two-step gate prevents accidental swaps.
  function requestQuickSetSubStatus(next: 'active' | 'refi_eligible' | 'payment_issues' | 'default' | 'refinanced') {
    if (next === subStatusKey) return;   // no-op
    setPendingConfirm({ kind: 'subStatus', next });
  }
  async function applyQuickSetSubStatus(next: 'active' | 'refi_eligible' | 'payment_issues' | 'default' | 'refinanced') {
    // Optimistic local update for instant feedback.
    onUpdated({ fundedSubStatus: next });
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fundedSubStatus: next }),
    });
    if (!res.ok) {
      // Roll back: re-fetch by reloading on the page-level state would be
      // overkill — we just leave the optimistic value; the user can retry.
    }
  }

  function requestQuickSetRep(repId: string) {
    if ((repId || null) === (deal.assignedRepId ?? null)) return;
    setPendingConfirm({ kind: 'rep', repId });
  }
  async function applyQuickSetRep(repId: string) {
    const newRepName = repId ? (reps.find((r) => r.id === repId)?.name ?? null) : null;
    onUpdated({ assignedRepId: repId || null, assignedRepName: newRepName });
    await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedRepId: repId || null }),
    });
  }

  async function save() {
    setSaving(true);
    const body: Record<string, unknown> = { ...draft };
    for (const k of ['fundedAmount', 'feePct', 'factorRate', 'termCount', 'amountCollected'] as const) {
      if (body[k] === '') body[k] = null;
    }
    if (body.fundingDate === '') body.fundingDate = null;
    // Empty rep id → unassign (null) so the column clears.
    if (body.assignedRepId === '') body.assignedRepId = null;
    // Empty / null funded-with → clear FK on save.
    if (body.fundedWithFunderId === '') body.fundedWithFunderId = null;
    // Trim notes; empty string → null so it doesn't render as " " on display.
    if (typeof body.fundedNotes === 'string') {
      body.fundedNotes = body.fundedNotes.trim() || null;
    }
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      // Include the rep NAME in the optimistic patch so the row shows
      // the new rep without a full reload.
      const repName = body.assignedRepId
        ? (reps.find((r) => r.id === body.assignedRepId)?.name ?? null)
        : null;
      onUpdated({ ...(body as Partial<Deal>), assignedRepName: repName });
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
        id={`funded-row-${deal.id}`}
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
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          {/* Inline sub-status select. Tone color matches the picked status.
              Stops row-expand on click so the user can change status without
              the row jumping open. Patches immediately via quickSetSubStatus. */}
          <select
            value={subStatusKey}
            onChange={(e) => requestQuickSetSubStatus(e.target.value as 'active' | 'refi_eligible' | 'payment_issues' | 'default' | 'refinanced')}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-pointer whitespace-nowrap',
              TONE_CLASS[subMeta.tone] ?? TONE_CLASS.gray
            )}
            title="Funded deal status"
          >
            <option value="active">Active</option>
            <option value="refi_eligible">Refi Eligible</option>
            <option value="payment_issues">Payment Issues</option>
            <option value="default">Default</option>
            {/* Refinanced — terminal status. Once chosen here the deal
                stops showing as refi-eligible (paydown logic short-circuits).
                The Mark-as-refinanced button is the richer flow that ALSO
                opens the new-deal form; this dropdown option just labels. */}
            <option value="refinanced">Refinanced</option>
          </select>
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
        {/* Actions cell — delete button. Click handler stops propagation so
            the row doesn't expand at the same time. Uses a confirmation
            modal (managed in the parent component) so the deletion isn't
            instant or browser-popup-based. */}
        <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onRequestDelete}
            title="Delete this deal"
            className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={11} className="px-4 py-4">
            <div className="space-y-3">
              {!editing && p.hasStructure && (
                <>
                  {/* Full detail panel — everything we know about this funded
                      deal. Grouped into sections so admins/reps can scan
                      quickly: paydown numbers → schedule → merchant info →
                      business info → notes/audit. Dates use
                      formatCalendarDate so they never shift one day from
                      the value that was typed in.
                      Fee % comes from the underlying deal record (not from
                      computePaydown) because the paydown engine doesn't
                      surface it. */}
                  <SectionLabel>Paydown</SectionLabel>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <Detail label="Funded amount" value={formatCurrency(p.fundedAmount)} />
                    <Detail label="Fee %" value={deal.feePct ? `${parseFloat(deal.feePct).toFixed(2)}%` : '—'} />
                    <Detail label="Factor rate" value={p.factorRate.toFixed(3)} />
                    <Detail label="Total payback" value={formatCurrency(p.totalPayback)} />
                    <Detail label="Amount collected" value={formatCurrency(p.amountCollected)} />
                    <Detail label="Remaining balance" value={formatCurrency(p.remainingBalance)} />
                    <Detail
                      label={p.termMode === 'daily' ? 'Daily payment' : 'Weekly payment'}
                      value={formatCurrency(p.paymentAmount)}
                    />
                    <Detail
                      label="Term"
                      value={`${p.termCount} ${p.termMode === 'daily' ? 'business days' : 'weeks'}`}
                    />
                    <Detail
                      label="Payments made"
                      value={`${p.paymentsMade} / ${p.paymentsTotal}`}
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
                          ? `~${formatCalendarDate(p.renewalDate)}`
                          : '—'}
                      tone={p.renewalEligible ? 'teal' : undefined}
                    />
                  </div>

                  <SectionLabel>Schedule</SectionLabel>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <Detail label="Funded date" value={formatCalendarDate(deal.fundingDate)} />
                    {/* First payment date: daily = next business day after
                        funding; weekly = same day, 7 days later. Matches the
                        cadence used by the buildPaymentSchedule generator. */}
                    <Detail
                      label="First payment"
                      value={p.fundingDate
                        ? formatCalendarDate(firstPaymentDate(p.fundingDate, p.termMode))
                        : '—'}
                    />
                    <Detail label="Est. payoff" value={p.payoffDate ? formatCalendarDate(p.payoffDate) : '—'} />
                    <Detail label="Term mode" value={p.termMode === 'daily' ? 'Daily (M–F)' : p.termMode === 'weekly' ? 'Weekly' : '—'} />
                  </div>

                  {/* Merchant + business contact info — pulled directly from
                      the deal record; nothing computed. */}
                  {(deal.merchantFirstName || deal.merchantLastName || deal.merchantEmail || deal.merchantPhone || deal.businessName) && (
                    <>
                      <SectionLabel>Merchant &amp; business</SectionLabel>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <Detail label="Merchant" value={`${deal.merchantFirstName ?? ''} ${deal.merchantLastName ?? ''}`.trim() || '—'} />
                        <Detail label="Phone" value={deal.merchantPhone || '—'} />
                        <Detail label="Email" value={deal.merchantEmail || '—'} />
                        <Detail label="Business name" value={deal.businessName || '—'} />
                        {(deal.businessAddress || deal.businessCity || deal.businessState || deal.businessZip) && (
                          <Detail
                            label="Business address"
                            value={[deal.businessAddress, deal.businessCity, deal.businessState, deal.businessZip].filter(Boolean).join(', ') || '—'}
                          />
                        )}
                        {deal.industry && <Detail label="Industry" value={deal.industry} />}
                      </div>
                    </>
                  )}

                  {(deal.notes || deal.renewalNotes || deal.fundedNotes || deal.fundedWithFunderId || deal.fundedWithName) && (
                    <>
                      <SectionLabel>Notes &amp; funder</SectionLabel>
                      {(deal.fundedWithFunderId || deal.fundedWithName) && (
                        <div className="text-xs">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Funded with</div>
                          <div className="text-foreground font-medium">
                            {funders.find((f) => f.id === deal.fundedWithFunderId)?.name
                              ?? deal.fundedWithName
                              ?? '—'}
                          </div>
                        </div>
                      )}
                      <div className="space-y-2 text-xs">
                        {/* The user's primary notes field on a funded deal —
                            also surfaced in /commissions next to the deal so
                            reps see the deal context alongside their pay. */}
                        {deal.fundedNotes && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Notes</div>
                            <div className="whitespace-pre-wrap text-foreground">{deal.fundedNotes}</div>
                          </div>
                        )}
                        {deal.notes && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Deal notes</div>
                            <div className="whitespace-pre-wrap text-foreground">{deal.notes}</div>
                          </div>
                        )}
                        {deal.renewalNotes && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Renewal notes</div>
                            <div className="whitespace-pre-wrap text-foreground">{deal.renewalNotes}</div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {(deal.createdAt || deal.updatedAt) && (
                    <>
                      <SectionLabel>Audit</SectionLabel>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        {deal.createdAt && <Detail label="Created" value={formatCalendarDate(deal.createdAt)} />}
                        {deal.updatedAt && <Detail label="Updated" value={formatCalendarDate(deal.updatedAt)} />}
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
                    {/* Quick rep changer in the detail view — same as the
                        editor but without entering edit mode. */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Assigned rep</span>
                      <select
                        value={deal.assignedRepId ?? ''}
                        onChange={(e) => requestQuickSetRep(e.target.value)}
                        className="h-7 text-xs rounded-md border border-input bg-card px-2"
                      >
                        <option value="">Unassigned</option>
                        {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-3 ml-auto">
                      {/* Mark as refinanced — terminal action: marks deal
                          paid off + 100% collected and opens the new
                          deal form pre-filled with merchant info.
                          Hidden once already refinanced so there's no
                          double-clicking the action. */}
                      {subStatusKey !== 'refinanced' && (
                        <button
                          onClick={() => { setRefiPayoff(''); setRefiOpen(true); }}
                          className="text-xs font-medium text-violet-700 hover:underline"
                          title="Mark this deal as paid off via refinance and start a new deal for the refi"
                        >
                          Mark as refinanced
                        </button>
                      )}
                      <button onClick={() => setEditing(true)} className="text-xs font-medium text-primary hover:underline">
                        Edit funding details
                      </button>
                    </div>
                  </div>
                </>
              )}

              {!editing && !p.hasStructure && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Funding details not entered yet. <button onClick={() => setEditing(true)} className="font-semibold underline">Add them</button> to enable paydown tracking.
                </div>
              )}

              {/* Syndications panel — visible whether editing or not, so
                  the user can see who else has skin in this deal at all
                  times. The component handles its own fetch + form
                  state internally so the parent doesn't have to manage
                  syndication state per row. */}
              <SyndicationsPanel
                dealId={deal.id}
                fundedAmount={p.fundedAmount}
                factorRate={p.factorRate}
                amountCollected={p.amountCollected}
                reps={reps}
              />

              {editing && (
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Funding details</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    <Field label="Funded amount">
                      <CurrencyInput value={String(draft.fundedAmount ?? '')} onChange={(v) => setDraft({ ...draft, fundedAmount: v })} placeholder="50,000" />
                    </Field>
                    <Field label="Fee">
                      <PercentInput value={String(draft.feePct ?? '')} onChange={(v) => setDraft({ ...draft, feePct: v })} placeholder="5" />
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
                      <Input type="date" value={toDateInput(draft.fundingDate ?? '')} onChange={(e) => setDraft({ ...draft, fundingDate: e.target.value })} />
                    </Field>
                    <Field label="Amount collected">
                      <CurrencyInput value={String(draft.amountCollected ?? '')} onChange={(v) => setDraft({ ...draft, amountCollected: v })} placeholder="auto if blank" />
                    </Field>
                    <Field label="Assigned rep">
                      <select
                        value={draft.assignedRepId}
                        onChange={(e) => setDraft({ ...draft, assignedRepId: e.target.value })}
                        className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                      >
                        <option value="">Unassigned</option>
                        {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Status">
                      <select
                        value={draft.fundedSubStatus}
                        onChange={(e) => setDraft({ ...draft, fundedSubStatus: e.target.value as 'active' | 'refi_eligible' | 'payment_issues' | 'default' | 'refinanced' })}
                        className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                      >
                        <option value="active">Active</option>
                        <option value="refi_eligible">Refi Eligible</option>
                        <option value="payment_issues">Payment Issues</option>
                        <option value="default">Default</option>
                        <option value="refinanced">Refinanced</option>
                      </select>
                    </Field>
                    {/* Funded With — which funder actually funded the deal.
                        Picked from the active funder directory. Defaults to
                        unset on legacy rows. */}
                    <Field label="Funded with">
                      <select
                        value={draft.fundedWithFunderId ?? ''}
                        onChange={(e) => setDraft({ ...draft, fundedWithFunderId: e.target.value || null })}
                        className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                      >
                        <option value="">— pick a funder —</option>
                        {funders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  {/* Notes — free-text, full-width below the field grid. Also
                      surfaced in the rep commission view, so reps see deal
                      context alongside their pay. */}
                  <div>
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Notes</div>
                    <textarea
                      value={draft.fundedNotes ?? ''}
                      onChange={(e) => setDraft({ ...draft, fundedNotes: e.target.value })}
                      rows={3}
                      className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm resize-y"
                      placeholder="Anything to remember about this deal — special terms, contact-of-record, watch list, etc."
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    {p.hasStructure && (
                      <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                    )}
                    <button
                      onClick={() => setPendingConfirm({ kind: 'save' })}
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

      {/* Mark-as-refinanced confirmation. Centered modal so the user has a
          chance to enter the actual payoff amount (often different from
          the contracted balance — discount, payoff at par minus a small
          credit, etc) and review what's about to happen before committing
          the action. We render inside a <tr><td colSpan> so the modal can
          appear within a table; the fixed-positioned overlay floats above
          everything regardless. */}

      {/* Two-step confirmation for state-changing actions on this row.
          Triggers from the inline status dropdown, the rep picker, and
          the Save button on the funding-details editor. The dialog
          renders inside its own <tr><td colSpan> because we're in a
          table; ConfirmDialog is fixed-positioned so it floats above
          the table regardless. */}
      {pendingConfirm && (
        <tr>
          <td colSpan={11} className="p-0">
            <ConfirmDialog
              open
              title={
                pendingConfirm.kind === 'subStatus'
                  ? `Change status to "${FUNDED_SUB_STATUS[pendingConfirm.next]?.label ?? pendingConfirm.next}"?`
                  : pendingConfirm.kind === 'rep'
                    ? `Reassign deal to ${pendingConfirm.repId ? (reps.find((r) => r.id === pendingConfirm.repId)?.name ?? 'this rep') : 'no one'}?`
                    : 'Save changes?'
              }
              description={
                pendingConfirm.kind === 'subStatus'
                  ? `This will update the funded-deal status on "${deal.name}".`
                  : pendingConfirm.kind === 'rep'
                    ? `Commission attribution for "${deal.name}" will move with the assignment.`
                    : `Apply the funding-details changes for "${deal.name}".`
              }
              confirmLabel={pendingConfirm.kind === 'save' ? 'Save changes' : 'Confirm'}
              onCancel={() => setPendingConfirm(null)}
              onConfirm={async () => {
                const p = pendingConfirm;
                setPendingConfirm(null);
                if (p.kind === 'subStatus') await applyQuickSetSubStatus(p.next);
                else if (p.kind === 'rep') await applyQuickSetRep(p.repId);
                else await save();
              }}
            />
          </td>
        </tr>
      )}

      {refiOpen && (
        <tr>
          <td colSpan={11} className="p-0">
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center p-4"
              onClick={() => !refiSaving && setRefiOpen(false)}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`refi-title-${deal.id}`}
            >
              <div className="absolute inset-0 bg-black/40" />
              <div
                className="relative bg-card rounded-lg border border-border shadow-xl max-w-md w-full p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="space-y-1">
                  <div id={`refi-title-${deal.id}`} className="text-base font-semibold">Mark as refinanced?</div>
                  <div className="text-xs text-muted-foreground">
                    This deal will be marked as paid off and 100% collected. We&apos;ll
                    then take you to Active Deals to log the new refi deal with
                    the merchant&apos;s info pre-filled.
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Actual payoff amount (optional)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={refiPayoff}
                    onChange={(e) => setRefiPayoff(e.target.value)}
                    placeholder="If different from the contracted balance"
                    className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <div className="text-[11px] text-muted-foreground">
                    Leave blank to use the contracted total payback. If the refi
                    settled at a discount, enter the actual settled amount —
                    we&apos;ll record it on the deal&apos;s renewal notes.
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setRefiOpen(false)}
                    disabled={refiSaving}
                    className="h-9 px-4 rounded-md text-sm font-medium hover:bg-muted text-muted-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={markRefinanced}
                    disabled={refiSaving}
                    className="h-9 px-4 rounded-md text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    {refiSaving ? 'Saving…' : 'Mark refinanced & log new deal'}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
function Detail({ label, value, tone }: { label: string; value: string; tone?: 'teal' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={cn('tabular-nums font-medium mt-0.5 break-words', tone === 'teal' ? 'text-teal-700' : 'text-foreground')}>{value}</div>
    </div>
  );
}

/** Section header inside the expand panel — groups Detail items into
 *  scannable buckets. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/70 pt-2 first:pt-0">
      {children}
    </div>
  );
}

/**
 * Compute the first payment date from a funding date + term mode.
 *
 *   • daily   → next business day (Mon–Fri, skip Sat/Sun)
 *   • weekly  → same day of the week, 7 days later
 *
 * Mirrors the cadence used by buildPaymentSchedule so the displayed
 * "First payment" date is exactly when payment #1 lands.
 */
function firstPaymentDate(funded: Date, termMode: 'daily' | 'weekly' | null): Date | null {
  if (!termMode) return null;
  const d = new Date(funded);
  if (termMode === 'daily') {
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  } else {
    d.setDate(d.getDate() + 7);
  }
  return d;
}

function Field({ label, children, required, className }: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('space-y-0.5', className)}>
      {label && (
        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
          {required && <span className="text-rose-600 ml-0.5">*</span>}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Drawer to manually create a funded deal from the Funded Deals page.
 *
 * Why this exists: the normal deal lifecycle is shop → submit → active →
 * funded. But sometimes deals enter the system as funded already (back-fill,
 * direct paper, etc.) and the user shouldn't have to walk one through every
 * earlier status just to get it onto the tracker.
 *
 * Posts to /api/deals with status='funded' and all the funding-detail
 * fields populated. The new row is handed back to the parent so it appears
 * in the table immediately.
 */
function AddFundedDealDrawer({
  reps,
  funders,
  onClose,
  onCreated,
}: {
  reps: { id: string; name: string }[];
  funders: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (deal: Deal) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    merchantFirstName: '',
    merchantLastName: '',
    merchantPhone: '',
    merchantEmail: '',
    businessName: '',
    fundedAmount: '',
    feePct: '',
    factorRate: '',
    termMode: 'weekly' as 'weekly' | 'daily',
    termCount: '',
    fundingDate: '',
    amountCollected: '',
    assignedRepId: '',
    fundedSubStatus: 'active' as 'active' | 'refi_eligible' | 'payment_issues' | 'default' | 'refinanced',
    fundedWithFunderId: '',
    fundedNotes: '',
  });

  async function submit() {
    setErr(null);
    if (!form.name.trim()) { setErr('Deal name is required.'); return; }
    setSaving(true);
    // Build the request body, converting empty strings to null where the API
    // expects null (numeric / FK columns).
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      status: 'funded',  // KEY — what makes this row appear on Funded Deals
      merchantFirstName: form.merchantFirstName.trim() || null,
      merchantLastName: form.merchantLastName.trim() || null,
      merchantPhone: form.merchantPhone.trim() || null,
      merchantEmail: form.merchantEmail.trim() || null,
      businessName: form.businessName.trim() || null,
      fundedAmount: form.fundedAmount || null,
      feePct: form.feePct || null,
      factorRate: form.factorRate || null,
      termMode: form.termMode,
      termCount: form.termCount || null,
      fundingDate: form.fundingDate || null,
      amountCollected: form.amountCollected || null,
      assignedRepId: form.assignedRepId || null,
      fundedSubStatus: form.fundedSubStatus,
      // Funded With + Notes go on the deal record directly so they appear in
      // the funded-deal expand view AND in the rep commission view.
      fundedWithFunderId: form.fundedWithFunderId || null,
      fundedNotes: form.fundedNotes.trim() || null,
    };
    const res = await fetch('/api/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || 'Could not create deal.');
      return;
    }
    const j = await res.json();
    const created = (j.data ?? j.deal) as Deal | undefined;
    if (created) onCreated(created);
    else onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-background border-l border-border h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold">Add funded deal</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}

          <SectionLabel>Deal</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deal name" required className="col-span-2">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Pizza – 1st Position" />
            </Field>
            <Field label="Assigned rep">
              <select
                value={form.assignedRepId}
                onChange={(e) => setForm({ ...form, assignedRepId: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="">Unassigned</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={form.fundedSubStatus}
                onChange={(e) => setForm({ ...form, fundedSubStatus: e.target.value as typeof form.fundedSubStatus })}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="refi_eligible">Refi Eligible</option>
                <option value="payment_issues">Payment Issues</option>
                <option value="default">Default</option>
              </select>
            </Field>
          </div>

          <SectionLabel>Merchant</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <Input value={form.merchantFirstName} onChange={(e) => setForm({ ...form, merchantFirstName: e.target.value })} />
            </Field>
            <Field label="Last name">
              <Input value={form.merchantLastName} onChange={(e) => setForm({ ...form, merchantLastName: e.target.value })} />
            </Field>
            <Field label="Business name" className="col-span-2">
              <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={form.merchantPhone} onChange={(e) => setForm({ ...form, merchantPhone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.merchantEmail} onChange={(e) => setForm({ ...form, merchantEmail: e.target.value })} />
            </Field>
          </div>

          <SectionLabel>Funding</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Funded amount">
              <CurrencyInput value={form.fundedAmount} onChange={(v) => setForm({ ...form, fundedAmount: v })} placeholder="50,000" />
            </Field>
            <Field label="Fee">
              <PercentInput value={form.feePct} onChange={(v) => setForm({ ...form, feePct: v })} placeholder="5" />
            </Field>
            <Field label="Factor rate">
              <Input inputMode="decimal" value={form.factorRate} onChange={(e) => setForm({ ...form, factorRate: e.target.value })} placeholder="1.40" />
            </Field>
            <Field label="Funding date">
              <Input type="date" value={form.fundingDate} onChange={(e) => setForm({ ...form, fundingDate: e.target.value })} />
            </Field>
            <Field label="Term type">
              <select
                value={form.termMode}
                onChange={(e) => setForm({ ...form, termMode: e.target.value as 'weekly' | 'daily' })}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
              </select>
            </Field>
            <Field label="# of payments">
              <Input inputMode="numeric" value={form.termCount} onChange={(e) => setForm({ ...form, termCount: e.target.value })} placeholder="26" />
            </Field>
            <Field label="Amount collected" className="col-span-2">
              <CurrencyInput value={form.amountCollected} onChange={(v) => setForm({ ...form, amountCollected: v })} placeholder="auto if blank" />
            </Field>
            <Field label="Funded with" className="col-span-2">
              <select
                value={form.fundedWithFunderId}
                onChange={(e) => setForm({ ...form, fundedWithFunderId: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="">— pick a funder —</option>
                {funders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
          </div>

          <SectionLabel>Notes</SectionLabel>
          <Field label="">
            <textarea
              value={form.fundedNotes}
              onChange={(e) => setForm({ ...form, fundedNotes: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm resize-y"
              placeholder="Anything to remember about this deal — special terms, watch list, etc. Shown alongside this deal in the rep commission view."
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact funded-deal display card.
 *
 * Pure presentation — does NOT contain edit state, save handlers, or any
 * mutation logic. Editing happens via the EXISTING FundedDealRow editor
 * which is unchanged. Clicking a card calls `onOpen`, which the parent
 * uses to flip into list view + auto-expand that row.
 *
 * Why this split?
 *   • Single source of truth for editing — the inline drawer on
 *     FundedDealRow already covers every field (funded amount, fee, factor,
 *     term, funding date, collected, sub-status, rep, funded-with funder,
 *     notes, paid-off + payoff amount). Duplicating that logic into a
 *     second editor risks the two drifting apart.
 *   • Card view stays light + scannable. The user wants a "nice display
 *     card" — that's exactly what this is.
 *   • Permissions stay enforced server-side. No new APIs touched.
 */
function FundedDealCard({
  deal,
  p,
  onOpen,
}: {
  deal: Deal;
  p: ReturnType<typeof computePaydown>;
  onOpen: () => void;
}) {
  const subStatusKey = deal.fundedSubStatus ?? 'active';
  const subMeta = FUNDED_SUB_STATUS[subStatusKey] ?? FUNDED_SUB_STATUS.active;
  const merchant = `${deal.merchantFirstName ?? ''} ${deal.merchantLastName ?? ''}`.trim();
  const isPaidOff = !!deal.paidOff;
  // Paid-off deals are visually "done" — full bar, deemphasized.
  // Refi-eligible deals get a teal accent on the progress bar to nudge the
  // admin toward action. Active and payment-issues use the same primary
  // bar — the badge already conveys those states.
  const barClass = isPaidOff
    ? 'bg-emerald-500/60'
    : (p.renewalEligible ? 'bg-teal-500' : 'bg-primary');

  return (
    <Card
      className="overflow-hidden cursor-pointer transition-shadow hover:shadow-md hover:border-foreground/20"
      onClick={onOpen}
      title="Click to view & edit details"
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: deal name + merchant + status badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold truncate">{deal.name}</div>
            {merchant && <div className="text-xs text-muted-foreground truncate">{merchant}</div>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {isPaidOff ? (
              // Paid off wins over the sub-status — once a deal is closed
              // out, that's the primary fact about it.
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-emerald-100 text-emerald-800 border-emerald-200">
                Paid off
              </span>
            ) : (
              <span className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border',
                TONE_CLASS[subMeta.tone] ?? TONE_CLASS.gray,
              )}>
                {subMeta.label}
              </span>
            )}
          </div>
        </div>

        {/* Balance + paid-in % side by side */}
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Balance</div>
            <div className="text-xl font-semibold tabular-nums">
              {p.hasStructure ? formatCurrency(p.remainingBalance) : '—'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Paid in</div>
            <div className={cn(
              'text-lg font-semibold tabular-nums',
              p.renewalEligible ? 'text-teal-700' : 'text-foreground',
            )}>
              {p.hasStructure ? `${Math.round(p.pctPaidIn)}%` : '—'}
            </div>
          </div>
        </div>

        {/* Paydown progress bar — primary visual element of the card. */}
        <div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', barClass)}
              style={{ width: `${Math.min(100, p.hasStructure ? p.pctPaidIn : 0)}%` }}
            />
          </div>
          {p.hasStructure && (
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>{p.paymentsMade}/{p.paymentsTotal} payments</span>
              <span>
                {isPaidOff
                  ? <span className="text-emerald-700 font-medium">Closed</span>
                  : p.renewalEligible
                    ? <span className="text-teal-700 font-medium">Refi ready</span>
                    : `refi ${p.renewalDate ? p.renewalDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}`}
              </span>
            </div>
          )}
        </div>

        {/* Footer: funded / payback / per-period payment in 3 cells */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border text-xs">
          <div>
            <div className="text-[10px] text-muted-foreground">Funded</div>
            <div className="tabular-nums font-medium">
              {p.hasStructure ? formatCurrency(p.fundedAmount, { compact: true }) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Payback</div>
            <div className="tabular-nums font-medium">
              {p.hasStructure ? formatCurrency(p.totalPayback, { compact: true }) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">
              {p.termMode === 'daily' ? 'Daily' : 'Weekly'}
            </div>
            <div className="tabular-nums font-medium">
              {p.hasStructure ? formatCurrency(p.paymentAmount, { compact: true }) : '—'}
            </div>
          </div>
        </div>

        {/* Dates strip — funded + estimated payoff */}
        <div className="text-[10px] text-muted-foreground">
          Funded {p.fundingDate ? p.fundingDate.toLocaleDateString() : '—'}
          {' · '}
          Payoff ~{p.payoffDate ? p.payoffDate.toLocaleDateString() : '—'}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Funded Deals dashboard
 * ─────────────────────────────────────────────────────────────────────
 * Sits at the top of /portfolio. Two charts + a quick-stat strip:
 *   1. Donut chart — deal sub-status breakdown (Active, Refi ready,
 *      Payment issues, Default, Paid off, Refinanced)
 *   2. Bar chart — funded volume + deal count for the last 12 months
 *   3. Finance KPIs strip — average deal size, average factor, refi-ready
 *      %, collected-vs-outstanding ratio. Numbers a portfolio manager
 *      checks first when assessing book health.
 *
 * All inline SVG — no chart library dependency. Animations are pure CSS;
 * keeps the bundle tight and renders instantly with no waterfall.
 * ───────────────────────────────────────────────────────────────────── */

interface BreakdownCounts {
  active: number;
  refi_eligible: number;
  payment_issues: number;
  default: number;
  paid_off: number;
  refinanced: number;
}

interface MonthlyVolume {
  key: string;
  label: string;
  volume: number;
  count: number;
}

interface PortfolioTotals {
  funded: number;
  payback: number;
  collected: number;
  remaining: number;
  refi: number;
  count: number;
}

function PortfolioDashboard({
  breakdown,
  monthly,
  totals,
}: {
  breakdown: BreakdownCounts;
  monthly: MonthlyVolume[];
  totals: PortfolioTotals;
}) {
  // Derived finance KPIs.
  // Average deal size = funded volume / # deals (with structure).
  // Collection ratio = collected / total payback expected — how much of
  // the book has come in. Doesn't include refinanced deals' refi proceeds.
  const avgDealSize = totals.count > 0 ? totals.funded / totals.count : 0;
  const collectionPct = totals.payback > 0 ? Math.round((totals.collected / totals.payback) * 100) : 0;
  const refiReadyPct = totals.count > 0 ? Math.round((totals.refi / totals.count) * 100) : 0;
  // Average factor = total payback / funded amount across the book.
  // Useful sanity check — should be in the 1.25-1.50 range; outside
  // that and something's off with the data.
  const avgFactor = totals.funded > 0 ? totals.payback / totals.funded : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* Pie chart — 1/3 width on large screens */}
      <Card className="lg:col-span-1">
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold">Deal mix</div>
            <div className="text-xs text-muted-foreground">By status, current book</div>
          </div>
          <BreakdownPie breakdown={breakdown} />
        </CardContent>
      </Card>

      {/* Bar chart — 2/3 width */}
      <Card className="lg:col-span-2">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-semibold">Monthly funding volume</div>
              <div className="text-xs text-muted-foreground">Last 12 months</div>
            </div>
            {/* Quick-glance: total volume over the window, so the chart
                is anchored to a number rather than just shapes. */}
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">12 mo total</div>
              <div className="text-base font-semibold tabular-nums">
                {formatCurrency(monthly.reduce((s, m) => s + m.volume, 0), { compact: true })}
              </div>
            </div>
          </div>
          <MonthlyVolumeBars monthly={monthly} />
        </CardContent>
      </Card>

      {/* Finance KPIs strip — full width below the two charts */}
      <Card className="lg:col-span-3">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPI
              label="Avg deal size"
              value={formatCurrency(avgDealSize, { compact: true })}
              sublabel="across active book"
            />
            <KPI
              label="Avg factor"
              value={avgFactor > 0 ? avgFactor.toFixed(2) : '—'}
              sublabel={
                avgFactor > 0 && (avgFactor < 1.2 || avgFactor > 1.55)
                  ? 'unusual range'
                  : 'within normal range'
              }
            />
            <KPI
              label="Collection rate"
              value={`${collectionPct}%`}
              sublabel={`${formatCurrency(totals.collected, { compact: true })} of ${formatCurrency(totals.payback, { compact: true })}`}
              tone={collectionPct >= 70 ? 'emerald' : collectionPct >= 40 ? 'amber' : undefined}
            />
            <KPI
              label="Refi-ready share"
              value={`${refiReadyPct}%`}
              sublabel={`${totals.refi} deal${totals.refi === 1 ? '' : 's'} ready to renew`}
              tone={refiReadyPct >= 20 ? 'teal' : undefined}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Donut pie chart — pure SVG, no library.
 *
 * The slice path math:
 *   For each slice, advance an accumulator angle and emit an arc path
 *   (M cx cy → L on outer radius → A arc → Z close). Donut effect is a
 *   second center circle in card background color. The whole thing is
 *   scaled to a 200x200 viewBox so it shrinks/grows cleanly with the
 *   container.
 *
 * Color palette matches the FUNDED_SUB_STATUS tones used elsewhere so
 * the legend, table badges, and pie all use the same vocabulary.
 */
function BreakdownPie({ breakdown }: { breakdown: BreakdownCounts }) {
  // Ordered so the most common categories appear first in the legend.
  // Active stays first because it's the default state of a healthy book.
  const slices: { key: keyof BreakdownCounts; label: string; color: string }[] = [
    { key: 'active',         label: 'Active',         color: '#10b981' }, // emerald-500
    { key: 'refi_eligible',  label: 'Refi ready',     color: '#14b8a6' }, // teal-500
    { key: 'payment_issues', label: 'Payment issues', color: '#f59e0b' }, // amber-500
    { key: 'default',        label: 'Default',        color: '#ef4444' }, // red-500
    { key: 'paid_off',       label: 'Paid off',       color: '#6b7280' }, // gray-500
    { key: 'refinanced',     label: 'Refinanced',     color: '#8b5cf6' }, // violet-500
  ];
  const total = slices.reduce((s, x) => s + breakdown[x.key], 0);

  // Empty book — show a placeholder ring so the layout doesn't collapse.
  if (total === 0) {
    return (
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 200 200" className="w-32 h-32 shrink-0">
          <circle cx="100" cy="100" r="85" fill="none" stroke="#e5e7eb" strokeWidth="30" />
        </svg>
        <div className="text-xs text-muted-foreground">No funded deals yet.</div>
      </div>
    );
  }

  // Build slice paths. We use a stroke instead of a true wedge fill so
  // the donut "thickness" stays uniform and we don't have to draw the
  // inner cutout — a 30-unit stroke on an r=85 circle is the donut.
  const cx = 100, cy = 100, r = 85;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const paths = slices.map((s) => {
    const v = breakdown[s.key];
    const pct = v / total;
    const len = circumference * pct;
    const dasharray = `${len} ${circumference - len}`;
    const dashoffset = -offset;
    offset += len;
    return { ...s, value: v, pct, dasharray, dashoffset };
  });

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <svg viewBox="0 0 200 200" className="w-32 h-32" style={{ transform: 'rotate(-90deg)' }}>
          {/* Underlying base ring so zero-slice statuses still show the
              donut shape rather than an arc cut. */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth="30" />
          {paths.filter((p) => p.value > 0).map((p) => (
            <circle
              key={p.key}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={p.color}
              strokeWidth="30"
              strokeDasharray={p.dasharray}
              strokeDashoffset={p.dashoffset}
            />
          ))}
        </svg>
        {/* Center label — total count of deals in the breakdown */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-2xl font-semibold tabular-nums leading-none">{total}</div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mt-0.5">Deals</div>
        </div>
      </div>

      {/* Legend — only categories with non-zero counts, percentage + count
          so the user can read both proportions and absolute numbers. */}
      <div className="flex-1 grid grid-cols-1 gap-1 min-w-0">
        {paths.filter((p) => p.value > 0).map((p) => (
          <div key={p.key} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
            <span className="truncate flex-1">{p.label}</span>
            <span className="tabular-nums text-muted-foreground shrink-0">{p.value}</span>
            <span className="tabular-nums text-muted-foreground/70 shrink-0 w-9 text-right">{Math.round(p.pct * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Monthly funded-volume bar chart — pure SVG.
 *
 * Each month is a bar; height proportional to that month's funded
 * volume against the max month in the window. Hover-state is the
 * built-in <title> tooltip — no library overhead.
 */
function MonthlyVolumeBars({ monthly }: { monthly: MonthlyVolume[] }) {
  const maxVolume = Math.max(...monthly.map((m) => m.volume), 1);
  // Show a "year change" tick label whenever the month is January. Helps
  // the user orient when the window spans across Dec → Jan.
  const now = new Date();

  return (
    <div>
      <div className="flex items-end gap-1.5 h-32">
        {monthly.map((m) => {
          const heightPct = (m.volume / maxVolume) * 100;
          const tooltip = m.volume > 0
            ? `${m.label}: ${m.count} deal${m.count === 1 ? '' : 's'}, ${formatCurrency(m.volume)}`
            : `${m.label}: no funded deals`;
          // Current month gets a darker shade so the eye lands on it.
          const isCurrent =
            now.getMonth() === parseInt(m.key.slice(5), 10) - 1 &&
            now.getFullYear() === parseInt(m.key.slice(0, 4), 10);
          return (
            <div
              key={m.key}
              className="flex-1 flex flex-col items-stretch justify-end h-full group"
              title={tooltip}
            >
              <div
                className={cn(
                  'w-full rounded-t-sm transition-colors',
                  isCurrent ? 'bg-primary' : 'bg-primary/40 group-hover:bg-primary/60',
                  m.volume === 0 && 'min-h-[2px] opacity-30',
                )}
                style={{ height: `${Math.max(heightPct, m.volume > 0 ? 4 : 1)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {monthly.map((m) => {
          const isJan = m.key.slice(5) === '01';
          return (
            <div key={m.key} className="flex-1 text-[10px] text-center text-muted-foreground tabular-nums">
              {isJan ? `${m.label} ${m.key.slice(2, 4)}` : m.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Small KPI cell for the finance strip below the charts. Slim variant
 * of <Stat> with an optional sublabel showing context.
 */
function KPI({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'emerald' | 'amber' | 'teal';
}) {
  const valueColor =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber'   ? 'text-amber-700'   :
    tone === 'teal'    ? 'text-teal-700'    :
    'text-foreground';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={cn('text-xl font-semibold tabular-nums mt-0.5', valueColor)}>{value}</div>
      {sublabel && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sublabel}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Syndications panel
 * ─────────────────────────────────────────────────────────────────────
 * Slim section on the funded-deal expand row that lists each rep who's
 * syndicated capital into the deal, plus their amount, share %, current
 * proportional return (based on what's been collected so far), expected
 * total return (their share × the contracted factor), and remaining.
 *
 * "+ Add syndication" opens an inline form right under the panel:
 *   • Rep picker (admin only)
 *   • Amount (CurrencyInput)
 *   • Notes (optional, single line)
 * On save, POSTs to /api/deals/[id]/syndications, reloads the list.
 *
 * Soft-delete via trash icon per row — admin only. Confirms inline so
 * we don't fire a browser popup mid-edit.
 *
 * Math reference (per-row):
 *   share = syndicatedAmount / fundedAmount
 *   expectedReturn = syndicatedAmount * factorRate
 *   collectedShare = amountCollected * share   (their cut of collections so far)
 *   remaining      = expectedReturn - collectedShare
 *
 * If fundedAmount or factorRate aren't yet known (the deal hasn't been
 * fully populated), we skip the math and just show the dollar amount.
 * ───────────────────────────────────────────────────────────────────── */

interface Syndication {
  id: string;
  dealId: string;
  repId: string | null;
  repName: string | null;
  syndicatedAmount: string;
  syndicatedDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function SyndicationsPanel({
  dealId,
  fundedAmount,
  factorRate,
  amountCollected,
  reps,
}: {
  dealId: string;
  fundedAmount: number;
  factorRate: number;
  amountCollected: number;
  reps: { id: string; name: string }[];
}) {
  const [syndications, setSyndications] = useState<Syndication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newRepId, setNewRepId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/deals/${dealId}/syndications`, { cache: 'no-store' });
      if (!r.ok) { setSyndications([]); return; }
      const j = await r.json();
      setSyndications(j.syndications ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dealId]);

  async function addSyndication() {
    setError(null);
    if (!newRepId) { setError('Pick a rep.'); return; }
    const amt = Number(newAmount.replace(/[^0-9.]/g, ''));
    if (!amt || amt <= 0) { setError('Enter a syndication amount.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/syndications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repId: newRepId,
          syndicatedAmount: amt,
          notes: newNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'Could not save syndication.');
        return;
      }
      setNewRepId('');
      setNewAmount('');
      setNewNotes('');
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteSyndication(sid: string) {
    if (!confirm('Remove this syndication?')) return;
    const res = await fetch(`/api/deals/${dealId}/syndications/${sid}`, { method: 'DELETE' });
    if (!res.ok) return;
    load();
  }

  // Totals across all rows — used in the header + footer of the panel.
  const totalSyndicated = syndications.reduce((s, x) => s + Number(x.syndicatedAmount || 0), 0);
  const hasStructure = fundedAmount > 0 && factorRate > 0;

  return (
    <div className="border border-border rounded-md bg-card/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Syndications</div>
          {syndications.length > 0 && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Total syndicated: <span className="tabular-nums font-medium">{formatCurrency(totalSyndicated)}</span>
              {hasStructure && fundedAmount > 0 && (
                <> · {Math.round((totalSyndicated / fundedAmount) * 100)}% of funded</>
              )}
            </div>
          )}
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-xs font-medium text-primary hover:underline"
          >
            + Add syndication
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-[11px] text-muted-foreground">Loading…</div>
      ) : syndications.length === 0 && !showForm ? (
        <div className="text-[11px] text-muted-foreground italic">
          No syndications on this deal yet.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60">
                <th className="py-1.5 pr-2 font-semibold">Rep</th>
                <th className="py-1.5 px-2 text-right font-semibold">Syndicated</th>
                <th className="py-1.5 px-2 text-right font-semibold">Share</th>
                <th className="py-1.5 px-2 text-right font-semibold">Expected return</th>
                <th className="py-1.5 px-2 text-right font-semibold">Collected so far</th>
                <th className="py-1.5 px-2 text-right font-semibold">Remaining</th>
                <th className="w-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {syndications.map((s) => {
                const amt = Number(s.syndicatedAmount);
                const share = hasStructure ? amt / fundedAmount : 0;
                const expectedReturn = hasStructure ? amt * factorRate : 0;
                const collectedShare = hasStructure ? amountCollected * share : 0;
                const remaining = Math.max(0, expectedReturn - collectedShare);
                return (
                  <tr key={s.id}>
                    <td className="py-1.5 pr-2">
                      <div className="font-medium">{s.repName ?? <span className="italic text-muted-foreground">removed rep</span>}</div>
                      {s.notes && <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{s.notes}</div>}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{formatCurrency(amt)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                      {hasStructure ? `${(share * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {hasStructure ? formatCurrency(expectedReturn) : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-emerald-700">
                      {hasStructure ? formatCurrency(collectedShare) : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {hasStructure ? formatCurrency(remaining) : '—'}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => deleteSyndication(s.id)}
                        title="Remove this syndication"
                        className="text-muted-foreground hover:text-destructive p-0.5"
                        aria-label="Remove syndication"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Inline add form. Slides into the panel rather than opening a
          modal so the user can see the existing syndications while
          adding a new one. */}
      {showForm && (
        <div className="border-t border-border pt-2 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="Rep">
              <select
                value={newRepId}
                onChange={(e) => setNewRepId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-card px-2 text-xs"
              >
                <option value="">Select a rep…</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Amount">
              <CurrencyInput value={newAmount} onChange={setNewAmount} placeholder="20,000" />
            </Field>
            <Field label="Notes (optional)">
              <input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="optional"
                className="h-8 w-full rounded-md border border-input bg-card px-2 text-xs"
              />
            </Field>
          </div>
          {error && <div className="text-[11px] text-destructive">{error}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); setNewRepId(''); setNewAmount(''); setNewNotes(''); }}
              disabled={saving}
              className="h-7 px-3 rounded-md text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addSyndication}
              disabled={saving}
              className="h-7 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add syndication'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
