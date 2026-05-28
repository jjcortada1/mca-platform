import Link from 'next/link';
import { db } from '@/lib/db/client';
import { deals, submissions, fundedEntries, funders } from '@/lib/db/schema';
import { eq, and, gte, count, sum } from 'drizzle-orm';
import { pageRequireTenant } from '@/lib/auth/context';
import { Briefcase, Inbox, TrendingUp, DollarSign, ShoppingBag, Send, Calculator, Users } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import PortfolioDashboard from '@/components/portfolio-dashboard';

export default async function DashboardPage() {
  const { user, companyId } = await pageRequireTenant();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [dealCount] = await db
    .select({ c: count() })
    .from(deals)
    .where(and(eq(deals.companyId, companyId), gte(deals.createdAt, monthStart)));

  const [submissionCount] = await db
    .select({ c: count() })
    .from(submissions)
    .where(and(eq(submissions.companyId, companyId), gte(submissions.createdAt, monthStart)));

  const [funded] = await db
    .select({ c: count(), total: sum(fundedEntries.amountFunded) })
    .from(fundedEntries)
    .where(and(eq(fundedEntries.companyId, companyId), gte(fundedEntries.fundedDate, monthStart)));

  const [funderCount] = await db
    .select({ c: count() })
    .from(funders)
    .where(and(eq(funders.companyId, companyId), eq(funders.isActive, true)));

  const stats = [
    { label: 'New Deals', sublabel: 'this month', value: dealCount?.c ?? 0, icon: Briefcase, color: 'text-blue-600 bg-blue-50' },
    { label: 'Submissions', sublabel: 'this month', value: submissionCount?.c ?? 0, icon: Inbox, color: 'text-violet-600 bg-violet-50' },
    { label: 'Deals Funded', sublabel: 'this month', value: funded?.c ?? 0, icon: TrendingUp, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Funded Volume', sublabel: 'this month', value: formatCurrency(Number(funded?.total ?? 0), { compact: true }), icon: DollarSign, color: 'text-amber-600 bg-amber-50' },
  ];

  const quickActions = [
    { href: '/deal-shop', label: 'Shop a deal', description: 'Find qualifying funders', icon: ShoppingBag },
    { href: '/submit', label: 'Submit a deal', description: 'Send to selected funders', icon: Send },
    { href: '/calculator', label: 'Open calculator', description: 'Forward & reverse MCA', icon: Calculator },
    { href: '/funders', label: 'Funder directory', description: `${funderCount?.c ?? 0} active funders`, icon: Users },
  ];

  return (
    <div className="space-y-8">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Welcome back</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{user.name.split(' ')[0]}</h1>
      </div>

      {/* Portfolio overview (statuses, pipeline, per-rep) leads the page */}
      <PortfolioDashboard />

      {/* This-month KPI tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="kpi-tile">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">{s.label}</div>
                  <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mt-0.5">{s.sublabel}</div>
                </div>
                <div className={`p-2 rounded-md ${s.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="text-3xl font-semibold tracking-tight mt-3 tabular-nums">{s.value}</div>
            </div>
          );
        })}
      </div>

      {/* Quick actions */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Quick actions</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.href}
                href={a.href}
                className="group rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-muted group-hover:bg-primary/10 transition-colors">
                    <Icon className="h-4 w-4 text-foreground/70 group-hover:text-primary transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.label}</div>
                    <div className="text-xs text-muted-foreground truncate">{a.description}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
