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
          No funded deals with a paydown structure yet. Add funded amount, factor, term, and funding date to a deal in Active Deals.
        </CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {portfolio.map(({ deal, p }) => {
            const m = meta(deal.status);
            const merchant = `${deal.merchantFirstName ?? ''} ${deal.merchantLastName ?? ''}`.trim();
            return (
              <Card key={deal.id} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{deal.name}</div>
                      {merchant && <div className="text-xs text-muted-foreground truncate">{merchant}</div>}
                    </div>
                    <span className={cn('shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border', TONE_CLASS[m.tone] ?? TONE_CLASS.gray)}>
                      {m.label}
                    </span>
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
