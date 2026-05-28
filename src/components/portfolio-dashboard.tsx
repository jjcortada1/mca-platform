'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';
import { DEAL_STATUS_META } from '@/lib/deals/paydown';

interface RepRow {
  repId: string; name: string; deals: number; funded: number; commission: number;
  paid: number; pending: number; draws: number; fundedCount: number; renewals: number; payingDown: number;
}
interface Portfolio {
  admin: boolean;
  overview: {
    fundedVolume: number; totalCommissions: number; paidCommissions: number; pendingCommissions: number;
    drawsOutstanding: number; dealCount: number; statusCounts: Record<string, number>;
  };
  reps: RepRow[];
}

const TONE_CLASS: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-800', blue: 'bg-blue-100 text-blue-800', gray: 'bg-gray-100 text-gray-700',
  slate: 'bg-slate-100 text-slate-700', violet: 'bg-violet-100 text-violet-800', emerald: 'bg-emerald-100 text-emerald-800',
  rose: 'bg-rose-100 text-rose-800', red: 'bg-red-100 text-red-800', orange: 'bg-orange-100 text-orange-800',
  teal: 'bg-teal-100 text-teal-800', cyan: 'bg-cyan-100 text-cyan-800',
};

// Order in which to surface deal statuses on the dashboard.
const STATUS_ORDER = ['submitted', 'waiting_on_offer', 'offer', 'funded', 'declined'];

export default function PortfolioDashboard() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [expandedRep, setExpandedRep] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/portfolio').then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  if (!data) return null;
  const { overview, reps, admin } = data;
  const statuses = STATUS_ORDER.filter((s) => overview.statusCounts[s]);

  return (
    <div className="space-y-8">
      {/* ---- PORTFOLIO OVERVIEW (top priority) ---- */}
      <section>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Portfolio overview</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Funded volume" value={formatCurrency(overview.fundedVolume, { compact: true })} accent="amber" />
          <Tile label="Funded deals" value={String(overview.statusCounts['funded'] ?? 0)} accent="emerald" />
          <Tile label="Offers out" value={String(overview.statusCounts['offer'] ?? 0)} accent="blue" />
          <Tile label="Submitted" value={String((overview.statusCounts['submitted'] ?? 0) + (overview.statusCounts['waiting_on_offer'] ?? 0))} accent="teal" />
        </div>
      </section>

      {/* ---- DEAL STATUS PIPELINE ---- */}
      {statuses.length > 0 && (
        <section>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Deal statuses</div>
          <div className="flex flex-wrap gap-2">
            {statuses.map((s) => {
              const meta = DEAL_STATUS_META[s] ?? { label: s, tone: 'gray' };
              return (
                <Link key={s} href={`/active-deals`} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg ${TONE_CLASS[meta.tone] ?? TONE_CLASS.gray}`}>
                  <span className="text-sm font-medium">{meta.label}</span>
                  <span className="tabular-nums text-xs font-semibold bg-white/50 px-1.5 py-0.5 rounded">{overview.statusCounts[s]}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- PER-REP SECTIONS (admin) ---- */}
      {admin && reps.length > 0 && (
        <section>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Reps</div>
          <div className="space-y-2">
            {reps.map((rep) => (
              <div key={rep.repId} className="rounded-lg border border-border bg-card overflow-hidden">
                <button onClick={() => setExpandedRep(expandedRep === rep.repId ? null : rep.repId)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition text-left">
                  <div className="font-medium">{rep.name}</div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{rep.deals} deals</span>
                    <span className="tabular-nums">{formatCurrency(rep.commission)} comm.</span>
                    <span>{expandedRep === rep.repId ? '▲' : '▼'}</span>
                  </div>
                </button>
                {expandedRep === rep.repId && (
                  <div className="px-4 py-3 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <Mini label="Funded volume" value={formatCurrency(rep.funded)} />
                    <Mini label="Funded deals" value={String(rep.fundedCount)} />
                    <Mini label="Paying down" value={String(rep.payingDown)} />
                    <Mini label="Eligible renewals" value={String(rep.renewals)} />
                    <Mini label="Commission" value={formatCurrency(rep.commission)} />
                    <Mini label="Paid" value={formatCurrency(rep.paid)} />
                    <Mini label="Pending" value={formatCurrency(rep.pending)} />
                    <Mini label="Draws outstanding" value={formatCurrency(rep.draws)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- COMMISSIONS (secondary, lower) ---- */}
      <section>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Commissions</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Total commission" value={formatCurrency(overview.totalCommissions, { compact: true })} />
          <Tile label="Paid" value={formatCurrency(overview.paidCommissions, { compact: true })} accent="emerald" />
          <Tile label="Pending" value={formatCurrency(overview.pendingCommissions, { compact: true })} accent="amber" />
          <Tile label="Draws outstanding" value={formatCurrency(overview.drawsOutstanding, { compact: true })} accent="rose" />
        </div>
        <Link href="/commissions" className="inline-block mt-3 text-sm text-primary hover:underline">Open commission tracker →</Link>
      </section>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const bar = accent === 'amber' ? 'bg-amber-500' : accent === 'blue' ? 'bg-blue-500' : accent === 'teal' ? 'bg-teal-500' : accent === 'rose' ? 'bg-rose-500' : accent === 'emerald' ? 'bg-emerald-500' : 'bg-primary';
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className={`h-1 w-8 rounded-full ${bar} mb-2`} />
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">{value}</div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div><div className="tabular-nums font-medium mt-0.5">{value}</div></div>;
}
