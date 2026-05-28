import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, dealCommissions, commissionDraws, users } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { resolveAutoStatus } from '@/lib/commissions/calc';
import { computePaydown } from '@/lib/deals/paydown';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(role: string, perms: string[]) {
  return role === 'company_admin' || role === 'master_admin' || perms.includes('commissions.manage');
}

/**
 * GET /api/portfolio
 * Admin: company-wide metrics + per-rep breakdown.
 * Rep: only their own metrics (company-wide totals omitted).
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const admin = isAdmin(ctx.user.role, ctx.user.permissions ?? []);
    const now = new Date();

    // Deals (scoped: admin = all, rep = own)
    const dealConds = [eq(deals.companyId, ctx.companyId)];
    if (!admin) dealConds.push(eq(deals.assignedRepId, ctx.user.id));
    const dealRows = await db.select().from(deals).where(and(...dealConds));

    // Commissions (same scoping)
    const commConds = [eq(dealCommissions.companyId, ctx.companyId), eq(dealCommissions.isDeleted, false)];
    if (!admin) commConds.push(eq(dealCommissions.repId, ctx.user.id));
    const commRows = await db.select().from(dealCommissions).where(and(...commConds));

    // Draws
    const drawConds = [eq(commissionDraws.companyId, ctx.companyId)];
    if (!admin) drawConds.push(eq(commissionDraws.repId, ctx.user.id));
    const drawRows = await db.select().from(commissionDraws).where(and(...drawConds));

    // Status counts
    const statusCounts: Record<string, number> = {};
    let fundedVolume = 0;
    for (const d of dealRows) {
      statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1;
      fundedVolume += Number(d.fundedAmount) || 0;
    }

    // Commission totals
    let totalComm = 0, paidComm = 0, pendingComm = 0;
    for (const c of commRows) {
      const amt = Number(c.repCommissionAmount);
      const paid = Number(c.paidAmount);
      const status = resolveAutoStatus(c.status, c.fundingDate, now);
      if (status === 'clawed_back') continue;
      totalComm += amt; paidComm += paid;
      if (status === 'pending') pendingComm += Math.max(0, amt - paid);
    }
    let drawsOutstanding = 0;
    for (const dr of drawRows) drawsOutstanding += Math.max(0, Number(dr.amount) - Number(dr.recoupedAmount));

    const overview = {
      fundedVolume,
      totalCommissions: totalComm,
      paidCommissions: paidComm,
      pendingCommissions: pendingComm,
      drawsOutstanding,
      dealCount: dealRows.length,
      statusCounts,
    };

    // Per-rep breakdown (admin only)
    let reps: any[] = [];
    if (admin) {
      // Only reps + admins appear in the per-rep breakdown. Lead source
      // accounts are excluded so they don't show up as empty rows.
      const repUsers = await db.select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(and(
          eq(users.companyId, ctx.companyId),
          inArray(users.role, ['rep', 'company_admin'] as const),
        ));
      const repMap = new Map(repUsers.map((u) => [u.id, u.name]));

      const byRep = new Map<string, { repId: string; name: string; deals: number; funded: number; commission: number; paid: number; pending: number; draws: number; fundedCount: number; renewals: number; payingDown: number }>();
      const ensure = (id: string) => {
        if (!byRep.has(id)) byRep.set(id, { repId: id, name: repMap.get(id) ?? 'Unassigned', deals: 0, funded: 0, commission: 0, paid: 0, pending: 0, draws: 0, fundedCount: 0, renewals: 0, payingDown: 0 });
        return byRep.get(id)!;
      };
      for (const d of dealRows) {
        if (!d.assignedRepId) continue;
        const e = ensure(d.assignedRepId);
        e.deals++; e.funded += Number(d.fundedAmount) || 0;
        if (d.status === 'funded') e.fundedCount++;
        // Renewal eligibility comes from paydown (50%+ paid in), not a status.
        const pd = computePaydown({
          fundedAmount: d.fundedAmount, factorRate: d.factorRate, termMode: d.termMode,
          termCount: d.termCount, fundingDate: d.fundingDate, amountCollected: d.amountCollected,
        }, now);
        if (pd.hasStructure) {
          e.payingDown++;
          if (pd.renewalEligible) e.renewals++;
        }
      }
      for (const c of commRows) {
        if (!c.repId) continue;
        const e = ensure(c.repId);
        const amt = Number(c.repCommissionAmount), paid = Number(c.paidAmount);
        const status = resolveAutoStatus(c.status, c.fundingDate, now);
        if (status === 'clawed_back') continue;
        e.commission += amt; e.paid += paid;
        if (status === 'pending') e.pending += Math.max(0, amt - paid);
      }
      for (const dr of drawRows) {
        if (!dr.repId) continue;
        ensure(dr.repId).draws += Math.max(0, Number(dr.amount) - Number(dr.recoupedAmount));
      }
      reps = Array.from(byRep.values()).sort((a, b) => b.commission - a.commission);
    }

    return NextResponse.json({ admin, overview, reps });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}
