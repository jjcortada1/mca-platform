import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, funders, users, leadSources } from '@/lib/db/schema';
import { and, eq, ilike, or, inArray, desc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { visibleRepIds } from '@/lib/auth/team-scope';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Global search across the system, scoped to what the caller may see:
 *   - Deals (by name / merchant), respecting rep + team-leader scoping.
 *   - Funders (by name), when the user can view funders.
 *   - People (reps/admins), admin only.
 * Each result carries a type, a label, a sublabel, and an href to navigate to.
 *
 * Query: ?q=<term>  (min 2 chars). Returns { data: Result[] } capped per group.
 */
interface SearchResult {
  type: 'deal' | 'funder' | 'person' | 'lead_source';
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json({ data: [] });

    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    const isAdmin = ctx.user.role === 'master_admin' || ctx.user.role === 'company_admin';
    const results: SearchResult[] = [];

    // ---- Deals (scoped) ----
    const dealConds = [eq(deals.companyId, ctx.companyId), eq(deals.isDeleted, false)];
    if (!isAdmin) {
      const scope = await visibleRepIds(ctx.user.id);
      dealConds.push(scope.length === 1 ? eq(deals.assignedRepId, scope[0]) : inArray(deals.assignedRepId, scope));
    }
    const dealRows = await db
      .select({
        id: deals.id, name: deals.name, status: deals.status,
        mf: deals.merchantFirstName, ml: deals.merchantLastName,
      })
      .from(deals)
      .where(and(
        ...dealConds,
        or(
          ilike(deals.name, like),
          ilike(deals.merchantFirstName, like),
          ilike(deals.merchantLastName, like),
          ilike(deals.merchantEmail, like),
        ),
      ))
      .orderBy(desc(deals.createdAt))
      .limit(8);
    // Funded/closed deals live on the portfolio (Funded Deals) page; every
    // other status is on Active Deals. Route each result to where it lives.
    const FUNDED_STATUSES = new Set(['funded', 'paid_off', 'closed']);
    for (const d of dealRows) {
      const merchant = [d.mf, d.ml].filter(Boolean).join(' ');
      const onPortfolio = FUNDED_STATUSES.has(d.status);
      results.push({
        type: 'deal', id: d.id, label: d.name,
        sublabel: merchant ? `Merchant: ${merchant}` : `Status: ${d.status}`,
        href: onPortfolio ? `/portfolio?deal=${d.id}` : `/active-deals?deal=${d.id}`,
      });
    }

    // ---- Funders (view permission) ----
    if (hasPermission(ctx.user, 'funders.view')) {
      const funderRows = await db
        .select({ id: funders.id, name: funders.name })
        .from(funders)
        .where(and(eq(funders.companyId, ctx.companyId), ilike(funders.name, like)))
        .orderBy(funders.name)
        .limit(6);
      for (const f of funderRows) {
        results.push({ type: 'funder', id: f.id, label: f.name, sublabel: 'Funder', href: `/funders?f=${f.id}` });
      }
    }

    // ---- People + lead sources (admin only) ----
    if (isAdmin) {
      const peopleRows = await db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role })
        .from(users)
        .where(and(
          eq(users.companyId, ctx.companyId),
          or(ilike(users.name, like), ilike(users.email, like)),
        ))
        .limit(6);
      for (const u of peopleRows) {
        if (u.role === 'lead_source') continue; // shown under lead sources below
        results.push({
          type: 'person', id: u.id, label: u.name,
          sublabel: u.role === 'company_admin' ? 'Admin' : 'Rep',
          href: `/settings?tab=users`,
        });
      }

      const lsRows = await db
        .select({ id: leadSources.id, name: leadSources.name })
        .from(leadSources)
        .where(and(eq(leadSources.companyId, ctx.companyId), ilike(leadSources.name, like)))
        .limit(5);
      for (const ls of lsRows) {
        results.push({ type: 'lead_source', id: ls.id, label: ls.name, sublabel: 'Lead source', href: `/settings?tab=leadsources` });
      }
    }

    return NextResponse.json({ data: results });
  } catch (e) { return apiError(e); }
}
