'use client';
/**
 * Funder Intel — which funders are winning your deals, what they offer,
 * and how they compare. Built entirely from data the CRM already records
 * (submissions, offers, funded deals) — nothing extra to type, ever.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  PageHeader, Card, CardContent, EmptyState, TableSkeleton,
} from '@/components/ui/primitives';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { BarChart3, Trophy } from 'lucide-react';

interface FunderStat {
  funderId: string;
  name: string;
  isActive: boolean;
  submissions: number;
  approved: number;
  declined: number;
  noResponse: number;
  approvalRate: number | null;
  offers: number;
  offersAccepted: number;
  avgOffer: number | null;
  avgFactor: number | null;
  wins: number;
  wonVolume: number;
  winRate: number | null;
}
interface Totals { submissions: number; approved: number; offers: number; wins: number; wonVolume: number }

const PERIODS = [
  { days: 0, label: 'All time' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
] as const;

export default function FunderAnalyticsPage() {
  const [rows, setRows] = useState<FunderStat[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [days, setDays] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [onlyActive, setOnlyActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Content stays visible while a new period loads (no flash) — the
    // skeleton only shows before the very first response.
    fetch(`/api/funder-analytics${days ? `?days=${days}` : ''}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setRows(Array.isArray(j?.data?.funders) ? j.data.funders : []);
        setTotals(j?.data?.totals ?? null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const visible = useMemo(
    () => rows.filter((r) => (!onlyActive || r.isActive) &&
      (r.submissions + r.offers + r.wins > 0 || !onlyActive)),
    [rows, onlyActive]
  );
  const maxWonVolume = useMemo(
    () => Math.max(...visible.map((r) => r.wonVolume), 1),
    [visible]
  );
  const topWinner = visible.find((r) => r.wins > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funder Intel"
        description="Who's winning your deals, what they offer, and how they stack up — built from your submissions, offers, and funded deals automatically."
        actions={
          <div className="flex items-center gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={cn(
                  'px-3 py-1.5 rounded-md border text-xs font-medium transition-colors',
                  days === p.days
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      {loading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No funders yet"
          description="Add funders and shop deals — their performance shows up here automatically."
        />
      ) : (
        <>
          {/* Topline */}
          {totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Submissions sent" value={totals.submissions.toLocaleString()} />
              <Kpi label="Approvals" value={totals.approved.toLocaleString()} sub={totals.submissions ? `${Math.round((totals.approved / totals.submissions) * 100)}% of sends` : undefined} />
              <Kpi label="Deals won by funders" value={totals.wins.toLocaleString()} />
              <Kpi label="Funded volume" value={formatCurrency(totals.wonVolume)} strong />
            </div>
          )}

          {topWinner && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm">
              <Trophy className="h-4 w-4 text-amber-500" />
              <span>
                <span className="font-semibold">{topWinner.name}</span>
                <span className="text-muted-foreground"> is your top funder {days ? `in the last ${days} days` : 'all-time'} — {topWinner.wins} deal{topWinner.wins === 1 ? '' : 's'} won, {formatCurrency(topWinner.wonVolume)} funded.</span>
              </span>
            </div>
          )}

          {/* Per-funder table */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                {visible.length} funder{visible.length === 1 ? '' : 's'} — ranked by deals won
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="accent-current" />
                Active funders only
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 980 }}>
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-left">
                    <Th>Funder</Th>
                    <Th right>Sent</Th>
                    <Th right>Approved</Th>
                    <Th right>Declined</Th>
                    <Th right>Approval %</Th>
                    <Th right>Offers</Th>
                    <Th right>Avg offer</Th>
                    <Th right>Avg factor</Th>
                    <Th right>Wins</Th>
                    <Th right>Win %</Th>
                    <Th>Funded volume</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {visible.map((r, i) => (
                    <tr key={r.funderId} className={cn('hover:bg-muted/20', !r.isActive && 'opacity-55')}>
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                        {i === 0 && r.wins > 0 && <Trophy className="inline h-3.5 w-3.5 text-amber-500 mr-1.5 -mt-0.5" />}
                        {r.name}
                        {!r.isActive && <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">inactive</span>}
                      </td>
                      <Td right>{r.submissions || '—'}</Td>
                      <Td right tone={r.approved > 0 ? 'good' : undefined}>{r.approved || '—'}</Td>
                      <Td right tone={r.declined > 0 ? 'bad' : undefined}>{r.declined || '—'}</Td>
                      <Td right>{r.approvalRate !== null ? `${r.approvalRate}%` : '—'}</Td>
                      <Td right>{r.offers || '—'}</Td>
                      <Td right>{r.avgOffer !== null ? formatCurrency(r.avgOffer) : '—'}</Td>
                      <Td right>{r.avgFactor !== null ? r.avgFactor.toFixed(3) : '—'}</Td>
                      <Td right tone={r.wins > 0 ? 'good' : undefined} strong>{r.wins || '—'}</Td>
                      <Td right>{r.winRate !== null ? `${r.winRate}%` : '—'}</Td>
                      <td className="px-3 py-2.5 min-w-[180px]">
                        <div className="flex items-center gap-2">
                          <div className="h-2 rounded-full bg-emerald-500/70 dark:bg-emerald-400/70"
                            style={{ width: `${Math.max(2, Math.round((r.wonVolume / maxWonVolume) * 100))}%`, maxWidth: '110px' }} />
                          <span className="tabular-nums text-xs font-medium whitespace-nowrap">
                            {r.wonVolume ? formatCurrency(r.wonVolume) : '—'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Sent / approved / declined come from your submissions; offers from the offers logged on deals; wins from deals marked funded with that funder. Numbers respect the selected period.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{label}</div>
        <div className={cn('text-xl tabular-nums mt-0.5', strong ? 'font-bold' : 'font-semibold')}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn('px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap', right && 'text-right')}>
      {children}
    </th>
  );
}
function Td({ children, right, tone, strong }: { children: React.ReactNode; right?: boolean; tone?: 'good' | 'bad'; strong?: boolean }) {
  return (
    <td className={cn(
      'px-3 py-2.5 tabular-nums whitespace-nowrap',
      right && 'text-right',
      strong && 'font-semibold',
      tone === 'good' && 'text-emerald-600 dark:text-emerald-400',
      tone === 'bad' && 'text-rose-600 dark:text-rose-400',
    )}>
      {children}
    </td>
  );
}
