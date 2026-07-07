import Link from 'next/link';
import { db } from '@/lib/db/client';
import { deals, submissions, fundedEntries, funders } from '@/lib/db/schema';
import { eq, and, gte, count, sum } from 'drizzle-orm';
import { pageRequireTenant } from '@/lib/auth/context';
import { Briefcase, Inbox, TrendingUp, DollarSign, ShoppingBag, Send, Calculator, Users, ArrowUpRight } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import PortfolioDashboard from '@/components/portfolio-dashboard';

export default async function DashboardPage() {
  const { user, companyId } = await pageRequireTenant();

  // Opportunistic automatic backup: when the first person from a company opens
  // the dashboard on a new day, take a daily data snapshot. Cheap no-op the
  // rest of the day (one small SELECT) and never throws, so it can't affect
  // the page render.
  const { ensureAutoBackup } = await import('@/lib/backup/snapshot');
  await ensureAutoBackup(companyId);

  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const prevMonthStart = new Date(monthStart);
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
  // 6-month window for the funded-volume trend chart.
  const sixMonthsAgo = new Date(monthStart);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);

  const [dealCount] = await db.select({ c: count() }).from(deals)
    .where(and(eq(deals.companyId, companyId), gte(deals.createdAt, monthStart)));
  const [submissionCount] = await db.select({ c: count() }).from(submissions)
    .where(and(eq(submissions.companyId, companyId), gte(submissions.createdAt, monthStart)));
  const [funded] = await db.select({ c: count(), total: sum(fundedEntries.amountFunded) }).from(fundedEntries)
    .where(and(eq(fundedEntries.companyId, companyId), gte(fundedEntries.fundedDate, monthStart)));
  const [funderCount] = await db.select({ c: count() }).from(funders)
    .where(and(eq(funders.companyId, companyId), eq(funders.isActive, true)));

  // Last-month comparatives for the delta chips.
  const [prevDeals] = await db.select({ c: count() }).from(deals)
    .where(and(eq(deals.companyId, companyId), gte(deals.createdAt, prevMonthStart)));
  const [prevSubs] = await db.select({ c: count() }).from(submissions)
    .where(and(eq(submissions.companyId, companyId), gte(submissions.createdAt, prevMonthStart)));
  const [prevFunded] = await db.select({ c: count(), total: sum(fundedEntries.amountFunded) }).from(fundedEntries)
    .where(and(eq(fundedEntries.companyId, companyId), gte(fundedEntries.fundedDate, prevMonthStart)));
  // gte(prevMonthStart) includes this month too — subtract to isolate last month.
  const lastMoDeals = Math.max(0, (prevDeals?.c ?? 0) - (dealCount?.c ?? 0));
  const lastMoSubs = Math.max(0, (prevSubs?.c ?? 0) - (submissionCount?.c ?? 0));
  const lastMoFundedCount = Math.max(0, (prevFunded?.c ?? 0) - (funded?.c ?? 0));
  const lastMoFundedTotal = Math.max(0, Number(prevFunded?.total ?? 0) - Number(funded?.total ?? 0));

  // Funded volume by month for the trend chart (6 buckets, oldest → newest).
  const trendRows = await db
    .select({ fundedDate: fundedEntries.fundedDate, amount: fundedEntries.amountFunded })
    .from(fundedEntries)
    .where(and(eq(fundedEntries.companyId, companyId), gte(fundedEntries.fundedDate, sixMonthsAgo)));
  const trend: { label: string; total: number; deals: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(monthStart);
    d.setMonth(d.getMonth() - i);
    trend.push({ label: d.toLocaleString('en-US', { month: 'short' }), total: 0, deals: 0 });
  }
  for (const r of trendRows) {
    const rd = new Date(r.fundedDate);
    const idx = (rd.getFullYear() - sixMonthsAgo.getFullYear()) * 12 + rd.getMonth() - sixMonthsAgo.getMonth();
    if (idx >= 0 && idx < 6) {
      trend[idx].total += Number(r.amount || 0);
      trend[idx].deals += 1;
    }
  }
  const trendMax = Math.max(1, ...trend.map((t) => t.total));

  function delta(current: number, previous: number): { text: string; up: boolean } | null {
    if (previous <= 0) return current > 0 ? { text: 'new', up: true } : null;
    const pct = Math.round(((current - previous) / previous) * 100);
    if (pct === 0) return { text: 'flat', up: true };
    return { text: `${pct > 0 ? '+' : ''}${pct}%`, up: pct >= 0 };
  }

  const firstName = (user.name || '').split(' ')[0] || 'there';
  const monthLabel = new Date().toLocaleString('en-US', { month: 'long' });

  const stats = [
    { label: 'New deals', value: String(dealCount?.c ?? 0), d: delta(dealCount?.c ?? 0, lastMoDeals), icon: Briefcase, accent: 'from-blue-500/10 to-blue-500/[0.03] border-blue-500/15', iconBg: 'bg-blue-500/10 text-blue-600' },
    { label: 'Submissions', value: String(submissionCount?.c ?? 0), d: delta(submissionCount?.c ?? 0, lastMoSubs), icon: Inbox, accent: 'from-violet-500/10 to-violet-500/[0.03] border-violet-500/15', iconBg: 'bg-violet-500/10 text-violet-600' },
    { label: 'Deals funded', value: String(funded?.c ?? 0), d: delta(funded?.c ?? 0, lastMoFundedCount), icon: TrendingUp, accent: 'from-emerald-500/10 to-emerald-500/[0.03] border-emerald-500/15', iconBg: 'bg-emerald-500/10 text-emerald-600' },
    { label: 'Funded volume', value: formatCurrency(Number(funded?.total ?? 0), { compact: true }), d: delta(Number(funded?.total ?? 0), lastMoFundedTotal), icon: DollarSign, accent: 'from-amber-500/10 to-amber-500/[0.03] border-amber-500/15', iconBg: 'bg-amber-500/10 text-amber-600' },
  ];

  const quickActions = [
    { href: '/deal-shop', label: 'Shop a deal', description: 'Find qualifying funders', icon: ShoppingBag },
    { href: '/submit', label: 'Submit a deal', description: 'Send to selected funders', icon: Send },
    { href: '/calculator', label: 'Open calculator', description: 'Forward & reverse MCA', icon: Calculator },
    { href: '/funders', label: 'Funder directory', description: `${funderCount?.c ?? 0} active funders`, icon: Users },
  ];

  return (
    <div className="space-y-7 sm:space-y-10 animate-fade-up">
      {/* Hero greeting */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Welcome back
        </div>
        <h1 className="text-[24px] sm:text-[32px] leading-[1.15] font-semibold tracking-tight mt-1.5">
          {firstName}.
        </h1>
        <p className="text-sm sm:text-[15px] text-muted-foreground mt-2">
          Here's what's happening across your brokerage in {monthLabel}.
        </p>
      </div>

      {/* This-month KPI tiles — big, polished, color-accented */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className={`relative overflow-hidden rounded-xl border bg-gradient-to-br ${s.accent} p-5 transition-all hover:shadow-[0_4px_16px_-4px_hsl(222_47%_11%/0.08)] hover:-translate-y-px`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {s.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">{monthLabel}</div>
                </div>
                <div className={`p-1.5 rounded-lg ${s.iconBg}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="flex items-end justify-between mt-5">
                <div className="text-[32px] leading-none font-semibold tracking-tight tabular-nums">{s.value}</div>
                {s.d && (
                  <span className={`text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${s.d.up ? 'text-emerald-700 bg-emerald-500/10' : 'text-rose-700 bg-rose-500/10'}`}>
                    {s.d.text}
                    <span className="text-muted-foreground/70 font-normal ml-1">vs last mo</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Funded volume trend — last 6 months, drawn server-side (no JS). */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Funded volume</div>
            <h2 className="text-lg font-semibold tracking-tight mt-1">Last 6 months</h2>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground">6-month total</div>
            <div className="text-lg font-semibold tabular-nums tracking-tight">
              {formatCurrency(trend.reduce((s, t) => s + t.total, 0), { compact: true })}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-6 gap-2 sm:gap-3 items-end h-[150px]">
          {trend.map((t, i) => {
            const h = Math.max(t.total > 0 ? 8 : 2, Math.round((t.total / trendMax) * 100));
            const isCurrent = i === trend.length - 1;
            return (
              <div key={t.label + i} className="flex flex-col items-center justify-end h-full gap-1.5">
                <div className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {t.total > 0 ? formatCurrency(t.total, { compact: true }) : ''}
                </div>
                <div
                  className={`w-full rounded-t-md transition-all ${isCurrent ? 'bg-primary' : 'bg-primary/30'}`}
                  style={{ height: `${h}%` }}
                  title={`${t.label}: ${formatCurrency(t.total)} across ${t.deals} deal${t.deals === 1 ? '' : 's'}`}
                />
                <div className={`text-[10.5px] ${isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{t.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Portfolio overview — statuses, pipeline, per-rep */}
      <PortfolioDashboard />

      {/* Quick actions */}
      <div>
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Quick actions
            </div>
            <h2 className="text-lg font-semibold tracking-tight mt-1">Get to work</h2>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.href}
                href={a.href}
                className="group rounded-xl border border-border bg-card p-5 transition-all hover:border-foreground/15 hover:shadow-[0_1px_3px_0_hsl(222_47%_11%/0.06),_0_4px_12px_-2px_hsl(222_47%_11%/0.06)]"
              >
                <div className="flex items-start justify-between">
                  <div className="p-2 rounded-lg bg-muted/60 group-hover:bg-foreground group-hover:text-background transition-colors">
                    <Icon className="h-4 w-4" />
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground/0 group-hover:text-foreground transition-all -translate-x-1 group-hover:translate-x-0" />
                </div>
                <div className="mt-4">
                  <div className="text-sm font-medium tracking-tight">{a.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{a.description}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
