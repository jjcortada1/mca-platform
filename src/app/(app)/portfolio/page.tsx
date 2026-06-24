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
  // Surfaced + editable on the funded-deal editor modal so admins can
  // correct typos / fill in missing details AFTER a deal has been logged.
  // The deal API already accepts these on PATCH.
  merchantPhone: string | null;
  merchantEmail: string | null;
  businessName: string | null;
  status: string;
  fundedAmount: string | null;
  feePct: string | null;
  factorRate: string | null;
  termMode: string | null;
  termCount: string | null;
  fundingDate: string | null;
  amountCollected: string | null;
  assignedRepId: string | null;
  // Paid-off tracking. Set together when admin marks a deal paid off.
  // paidOffAmount captures the ACTUAL settled amount (often less than the
  // contracted total payback because of early-payoff discounts).
  paidOff: boolean | null;
  paidOffAmount: string | null;
  paidOffDate: string | null;
  // Funded sub-status — 'active' | 'refi_eligible' | 'payment_issues' |
  // 'default'. Null treated as 'active'. The merchant edit modal exposes
  // a dropdown to flip this so admins can flag refi-ready or defaulted
  // deals without leaving the portfolio.
  fundedSubStatus: string | null;
  // Notes attached to a funded deal — surfaced in the edit modal and on
  // the rep commission view for context.
  fundedNotes: string | null;
  // Funder that ultimately funded this deal. FK to funders table, or a
  // free-text label for off-directory funders.
  fundedWithFunderId: string | null;
  fundedWithName: string | null;
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
  // Deal currently open for editing. null = no modal showing.
  // Clicking any funded-deal card opens this modal with the deal's
  // merchant details pre-filled so admins can correct after logging.
  const [editing, setEditing] = useState<Deal | null>(null);

  useEffect(() => {
    fetch('/api/deals', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      setDeals((j.data ?? j.deals ?? []) as Deal[]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Compute paydown for each deal (live, as of today).
  const enriched = useMemo(() => deals.map((d) => ({
    deal: d,
    p: computePaydown({
      fundedAmount: d.fundedAmount, factorRate: d.factorRate, termMode: d.termMode,
      termCount: d.termCount, fundingDate: d.fundingDate, amountCollected: d.amountCollected,
    }),
  })), [deals]);

  const portfolio = useMemo(() => {
    let list = enriched.filter((e) => e.p.hasStructure);
    if (view === 'paying') list = list.filter((e) => !e.p.renewalEligible && e.p.pctPaidIn < 100);
    if (view === 'refi') list = list.filter((e) => e.p.renewalEligible);
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
      <PageHeader title="Portfolio" description="Live view of every funded deal — balance, paydown, and renewal status update automatically." />

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
          No funded deals with a paydown structure yet. Add funded amount, factor, term, and funding date to a deal in Active Deals.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {portfolio.map(({ deal, p }) => {
            const m = meta(deal.status);
            const merchant = `${deal.merchantFirstName ?? ''} ${deal.merchantLastName ?? ''}`.trim();
            return (
              <Card
                key={deal.id}
                className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setEditing(deal)}
                title="Click to edit merchant details"
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{deal.name}</div>
                      {merchant && <div className="text-xs text-muted-foreground truncate">{merchant}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {deal.paidOff ? (
                        // Paid off takes visual precedence over everything
                        // else — once a deal is closed out, that's the
                        // primary fact about it on the portfolio.
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-emerald-100 text-emerald-800 border-emerald-200">
                          Paid off
                        </span>
                      ) : (
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border', TONE_CLASS[m.tone] ?? TONE_CLASS.gray)}>
                          {m.label}
                        </span>
                      )}
                      {/* Funded sub-status badge — shown when refi-ready or
                          defaulted so admins spot them at a glance without
                          opening the card. Active is the default state and
                          doesn't need its own badge. */}
                      {!deal.paidOff && deal.fundedSubStatus === 'refi_eligible' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-teal-100 text-teal-800 border-teal-200">
                          Refi ready
                        </span>
                      )}
                      {!deal.paidOff && deal.fundedSubStatus === 'default' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-red-100 text-red-800 border-red-200">
                          Default
                        </span>
                      )}
                      {!deal.paidOff && deal.fundedSubStatus === 'payment_issues' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-amber-100 text-amber-800 border-amber-200">
                          Payment issues
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Balance */}
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Balance</div>
                      <div className="text-xl font-semibold tabular-nums">{formatCurrency(p.remainingBalance)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Paid in</div>
                      <div className={cn('text-lg font-semibold tabular-nums', p.renewalEligible ? 'text-teal-700' : 'text-foreground')}>{p.pctPaidIn}%</div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', p.renewalEligible ? 'bg-teal-500' : 'bg-primary')} style={{ width: `${Math.min(100, p.pctPaidIn)}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>{p.paymentsMade}/{p.paymentsTotal} payments</span>
                      <span>{p.renewalEligible ? <span className="text-teal-700 font-medium">Refi ready</span> : `refi ${p.renewalDate ? p.renewalDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}`}</span>
                    </div>
                  </div>

                  {/* Footer stats */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border text-xs">
                    <div><div className="text-[10px] text-muted-foreground">Funded</div><div className="tabular-nums font-medium">{formatCurrency(p.fundedAmount, { compact: true })}</div></div>
                    <div><div className="text-[10px] text-muted-foreground">Payback</div><div className="tabular-nums font-medium">{formatCurrency(p.totalPayback, { compact: true })}</div></div>
                    <div><div className="text-[10px] text-muted-foreground">{p.termMode === 'daily' ? 'Daily' : 'Weekly'}</div><div className="tabular-nums font-medium">{formatCurrency(p.paymentAmount, { compact: true })}</div></div>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Funded {p.fundingDate ? p.fundingDate.toLocaleDateString() : '—'} · Payoff ~{p.payoffDate ? p.payoffDate.toLocaleDateString() : '—'}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit modal — opens when a card is clicked. Currently only the
          merchant details are editable. Other deal mechanics (funded amount,
          factor, term, etc.) live under /active-deals so we don't duplicate
          the form here. */}
      {editing && (
        <EditFundedDealModal
          deal={editing}
          onClose={() => setEditing(null)}
          onSaved={(patched) => {
            setDeals((arr) => arr.map((d) => d.id === editing.id ? { ...d, ...patched } : d));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Lightweight modal for editing the merchant details on a funded deal
 * after it's been logged. Centered card, backdrop click + Escape cancel.
 * Saves via PATCH /api/deals/[id] which already accepts these fields.
 */
function EditFundedDealModal({
  deal,
  onClose,
  onSaved,
}: {
  deal: Deal;
  onClose: () => void;
  onSaved: (patched: Partial<Deal>) => void;
}) {
  const [firstName, setFirstName] = useState(deal.merchantFirstName ?? '');
  const [lastName, setLastName] = useState(deal.merchantLastName ?? '');
  const [phone, setPhone] = useState(deal.merchantPhone ?? '');
  const [email, setEmail] = useState(deal.merchantEmail ?? '');
  const [businessName, setBusinessName] = useState(deal.businessName ?? '');
  // Funded sub-status — null treated as 'active'. The dropdown lets the
  // admin flag a deal as refi-ready, payment-issues, or default without
  // leaving the portfolio. Persists to deals.fundedSubStatus.
  const [subStatus, setSubStatus] = useState<string>(deal.fundedSubStatus ?? 'active');
  // Notes attached to the funded deal — surfaced on the card detail and
  // on the rep commission view so context follows the deal everywhere.
  const [fundedNotes, setFundedNotes] = useState(deal.fundedNotes ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Inline "mark as paid off" view. Switches the modal into a focused
  // payoff-amount form when the admin clicks the button. View toggles
  // back to the merchant editor on cancel. Defaults to today's date so
  // the common case is one click + save.
  const [payoffOpen, setPayoffOpen] = useState(false);
  // Default the amount field to the current remaining balance estimate if
  // we have funded+fee data. Otherwise leave blank for manual entry.
  const today = new Date().toISOString().slice(0, 10);
  const [payoffAmount, setPayoffAmount] = useState<string>('');
  const [payoffDate, setPayoffDate] = useState<string>(today);

  // Escape closes the modal — table-stakes ergonomics for any dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // If we're in the payoff sub-view, escape returns to the editor
        // first (one cancel level at a time, like macOS sheet behavior).
        if (payoffOpen) setPayoffOpen(false);
        else onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, payoffOpen]);

  async function save() {
    setSaving(true);
    setErr(null);
    const body: Record<string, unknown> = {};
    if (firstName !== (deal.merchantFirstName ?? '')) body.merchantFirstName = firstName.trim() || null;
    if (lastName !== (deal.merchantLastName ?? ''))   body.merchantLastName  = lastName.trim()  || null;
    if (phone !== (deal.merchantPhone ?? ''))         body.merchantPhone     = phone.trim()     || null;
    if (email !== (deal.merchantEmail ?? ''))         body.merchantEmail     = email.trim()     || null;
    if (businessName !== (deal.businessName ?? ''))   body.businessName      = businessName.trim() || null;
    // Status / notes — only patch if changed so we don't churn the
    // updatedAt on every Save click. Empty notes become null so display
    // logic doesn't render a blank row.
    if (subStatus !== (deal.fundedSubStatus ?? 'active')) body.fundedSubStatus = subStatus;
    if (fundedNotes !== (deal.fundedNotes ?? ''))         body.fundedNotes     = fundedNotes.trim() || null;
    if (Object.keys(body).length === 0) { onClose(); return; }

    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || 'Save failed.');
      return;
    }
    onSaved(body as Partial<Deal>);
  }

  /**
   * Persist the paid-off state for this deal. We require an explicit
   * payoff amount (the user might have negotiated an early-payoff
   * discount; we want the ACTUAL amount, not the contracted total).
   * Empty amount is allowed and stored as null — useful if the admin
   * wants to mark it paid off and circle back to fill in the number.
   */
  async function savePayoff() {
    setSaving(true);
    setErr(null);
    const body: Record<string, unknown> = {
      paidOff: true,
      paidOffAmount: payoffAmount.trim() || null,
      paidOffDate: payoffDate || today,
    };
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || 'Save failed.');
      return;
    }
    onSaved({
      paidOff: true,
      paidOffAmount: body.paidOffAmount as string | null,
      paidOffDate: body.paidOffDate as string,
    });
  }

  /** Reverse a paid-off marking — for typos / accidental marks. */
  async function unmarkPayoff() {
    setSaving(true);
    setErr(null);
    const body = { paidOff: false, paidOffAmount: null, paidOffDate: null };
    const res = await fetch(`/api/deals/${deal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || 'Save failed.');
      return;
    }
    onSaved({ paidOff: false, paidOffAmount: null, paidOffDate: null });
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-card rounded-lg border border-border shadow-xl max-w-md w-full p-5 space-y-4 animate-modal-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="space-y-0.5">
          <div className="text-base font-semibold">
            {payoffOpen ? 'Mark as paid off' : 'Edit merchant details'}
          </div>
          <div className="text-xs text-muted-foreground truncate">{deal.name}</div>
        </div>

        {/* PAYOFF SUB-VIEW */}
        {payoffOpen ? (
          <>
            <div className="text-xs text-muted-foreground">
              Enter the actual payoff amount. If the merchant got an early-payoff
              discount, this should be the discounted amount they actually paid —
              not the contracted total payback.
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Payoff amount ($)</label>
              <Input
                type="text"
                inputMode="decimal"
                value={payoffAmount}
                onChange={(e) => setPayoffAmount(e.target.value)}
                placeholder="e.g. 32000 (leave blank to fill in later)"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Payoff date</label>
              <Input
                type="date"
                value={payoffDate}
                onChange={(e) => setPayoffDate(e.target.value)}
              />
            </div>

            {err && <div className="text-xs text-destructive">{err}</div>}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setPayoffOpen(false)}
                disabled={saving}
                className="h-9 px-4 rounded-md text-sm font-medium hover:bg-muted text-muted-foreground"
              >
                Back
              </button>
              <button
                type="button"
                onClick={savePayoff}
                disabled={saving}
                className="h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Mark paid off'}
              </button>
            </div>
          </>
        ) : (
          /* MERCHANT EDITOR — DEFAULT VIEW */
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">First name</label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Last name</label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Business name</label>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Pizza LLC" />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@acmepizza.com" />
            </div>

            {/* Funded sub-status — distinct visual block (border-top) so
                the admin immediately reads it as a deal-level lifecycle
                action, not a merchant edit. Only shown when the deal
                isn't already paid off, since the payoff state supersedes
                all sub-statuses. */}
            {!deal.paidOff && (
              <div className="pt-3 border-t border-border space-y-1">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Status</label>
                <select
                  value={subStatus}
                  onChange={(e) => setSubStatus(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="refi_eligible">Refi ready</option>
                  <option value="payment_issues">Payment issues</option>
                  <option value="default">Default</option>
                </select>
              </div>
            )}

            {/* Funded notes — free text, full width below the field grid.
                Surfaced on the rep commission view too so context follows
                the deal. */}
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Notes</label>
              <textarea
                value={fundedNotes}
                onChange={(e) => setFundedNotes(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm resize-y"
                placeholder="Anything to remember about this deal — special terms, watch-list flags, contact-of-record, etc."
              />
            </div>

            {/* Paid-off block — current state + action. Distinct visual
                weight from the merchant fields above so the admin
                immediately sees this is a state change, not an edit. */}
            <div className="pt-3 border-t border-border space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Paid off</div>
              {deal.paidOff ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200">
                  <div>
                    <div className="text-sm font-medium text-emerald-900">Paid off</div>
                    {deal.paidOffAmount && (
                      <div className="text-xs text-emerald-800">
                        {formatCurrency(Number(deal.paidOffAmount))}
                        {deal.paidOffDate && ` on ${new Date(deal.paidOffDate).toLocaleDateString()}`}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={unmarkPayoff}
                    disabled={saving}
                    className="text-xs font-medium text-emerald-900 hover:underline"
                  >
                    Unmark
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPayoffOpen(true)}
                  disabled={saving}
                  className="w-full h-9 px-3 rounded-md text-sm font-medium border border-border bg-card hover:bg-muted text-foreground"
                >
                  Mark as paid off
                </button>
              )}
            </div>

            {err && <div className="text-xs text-destructive">{err}</div>}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="h-9 px-4 rounded-md text-sm font-medium hover:bg-muted text-muted-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        )}
      </div>
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
