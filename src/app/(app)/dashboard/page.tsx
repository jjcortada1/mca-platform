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

  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [dealCount] = await db.select({ c: count() }).from(deals)
    .where(and(eq(deals.companyId, companyId), gte(deals.createdAt, monthStart)));
  const [submissionCount] = await db.select({ c: count() }).from(submissions)
    .where(and(eq(submissions.companyId, companyId), gte(submissions.createdAt, monthStart)));
  const [funded] = await db.select({ c: count(), total: sum(fundedEntries.amountFunded) }).from(fundedEntries)
    .where(and(eq(fundedEntries.companyId, companyId), gte(fundedEntries.fundedDate, monthStart)));
  const [funderCount] = await db.select({ c: count() }).from(funders)
    .where(and(eq(funders.companyId, companyId), eq(funders.isActive, true)));

  const firstName = (user.name || '').split(' ')[0] || 'there';
  const monthLabel = new Date().toLocaleString('en-US', { month: 'long' });

  const stats = [
    { label: 'New deals', value: String(dealCount?.c ?? 0), icon: Briefcase, accent: 'from-blue-500/10 to-blue-500/[0.03] border-blue-500/15', iconBg: 'bg-blue-500/10 text-blue-600' },
    { label: 'Submissions', value: String(submissionCount?.c ?? 0), icon: Inbox, accent: 'from-violet-500/10 to-violet-500/[0.03] border-violet-500/15', iconBg: 'bg-violet-500/10 text-violet-600' },
    { label: 'Deals funded', value: String(funded?.c ?? 0), icon: TrendingUp, accent: 'from-emerald-500/10 to-emerald-500/[0.03] border-emerald-500/15', iconBg: 'bg-emerald-500/10 text-emerald-600' },
    { label: 'Funded volume', value: formatCurrency(Number(funded?.total ?? 0), { compact: true }), icon: DollarSign, accent: 'from-amber-500/10 to-amber-500/[0.03] border-amber-500/15', iconBg: 'bg-amber-500/10 text-amber-600' },
  ];

  const quickActions = [
    { href: '/deal-shop', label: 'Shop a deal', description: 'Find qualifying funders', icon: ShoppingBag },
    { href: '/submit', label: 'Submit a deal', description: 'Send to selected funders', icon: Send },
    { href: '/calculator', label: 'Open calculator', description: 'Forward & reverse MCA', icon: Calculator },
    { href: '/funders', label: 'Funder directory', description: `${funderCount?.c ?? 0} active funders`, icon: Users },
  ];

  return (
    <div className="space-y-10 animate-fade-up">
      {/* Hero greeting */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Welcome back
        </div>
        <h1 className="text-[32px] leading-[1.15] font-semibold tracking-tight mt-1.5">
          {firstName}.
        </h1>
        <p className="text-[15px] text-muted-foreground mt-2">
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
              <div className="text-[32px] leading-none font-semibold tracking-tight mt-5 tabular-nums">{s.value}</div>
            </div>
          );
        })}
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
