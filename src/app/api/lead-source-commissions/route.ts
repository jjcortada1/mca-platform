import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { leadSourceCommissions, leadSources, deals, dealCommissions } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { triggerSync } from '@/lib/sheets/sync';
import { computeLeadSourceCommission, resolveAutoStatus } from '@/lib/commissions/calc';
import { z } from 'zod';

export const runtime = 'nodejs';

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
}

/**
 * GET /api/lead-source-commissions
 * Admin: full detail for all lead source commissions (deal + merchant + amounts).
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const rows = await db
      .select({
        lsc: leadSourceCommissions,
        dealName: deals.name,
        merchantFirstName: deals.merchantFirstName,
        merchantLastName: deals.merchantLastName,
        fundedAmount: dealCommissions.fundedAmount,
        grossCommission: dealCommissions.grossCommission,
        brokerFee: dealCommissions.brokerFee,
        repSplitPct: dealCommissions.repSplitPct,
        leadSourceName: leadSources.name,
      })
      .from(leadSourceCommissions)
      .innerJoin(deals, eq(deals.id, leadSourceCommissions.dealId))
      .innerJoin(leadSources, eq(leadSources.id, leadSourceCommissions.leadSourceId))
      .leftJoin(dealCommissions, eq(dealCommissions.dealId, leadSourceCommissions.dealId))
      .where(and(eq(leadSourceCommissions.companyId, ctx.companyId), eq(leadSourceCommissions.isDeleted, false)))
      .orderBy(desc(leadSourceCommissions.updatedAt));

    const now = new Date();
    const data = rows.map((r) => {
      const amt = Number(r.lsc.commissionAmount);
      const paid = Number(r.lsc.paidAmount);
      const status = resolveAutoStatus(r.lsc.status, null, now); // lead-source has no funding auto-clear unless desired
      return {
        id: r.lsc.id,
        dealId: r.lsc.dealId,
        dealName: r.dealName,
        merchantName: [r.merchantFirstName, r.merchantLastName].filter(Boolean).join(' ') || null,
        leadSourceId: r.lsc.leadSourceId,
        leadSourceName: r.leadSourceName,
        fundedAmount: r.fundedAmount,
        grossCommission: r.grossCommission,
        brokerFee: r.brokerFee,
        repSplitPct: r.repSplitPct,
        splitPct: r.lsc.splitPct,
        flatAmount: r.lsc.flatAmount,
        commissionAmount: r.lsc.commissionAmount,
        paidAmount: r.lsc.paidAmount,
        owedAmount: r.lsc.status === 'clawed_back' ? 0 : Math.max(0, amt - paid),
        pendingAmount: r.lsc.status === 'pending' ? Math.max(0, amt - paid) : 0,
        status: r.lsc.status,
        earlyPayoffDiscount: r.lsc.earlyPayoffDiscount,
        notes: r.lsc.notes,
        syncState: r.lsc.syncState,
        updatedAt: r.lsc.updatedAt,
      };
    });
    return NextResponse.json({ leadSourceCommissions: data, data });
  } catch (e) { return apiError(e); }
}

const upsertSchema = z.object({
  dealId: z.string().uuid(),
  leadSourceId: z.string().uuid(),
  splitPct: z.coerce.number().min(0).max(100).optional().nullable(),
  flatAmount: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * POST /api/lead-source-commissions
 * Admin. Upsert (by deal + lead source). Computes owed from flat OR split% of gross.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = upsertSchema.parse(await req.json());

    // Tenant guards
    const [deal] = await db.select().from(deals).where(eq(deals.id, body.dealId)).limit(1);
    if (!deal || deal.companyId !== ctx.companyId) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    const [ls] = await db.select().from(leadSources).where(eq(leadSources.id, body.leadSourceId)).limit(1);
    if (!ls || ls.companyId !== ctx.companyId) return NextResponse.json({ error: 'Lead source not found' }, { status: 404 });

    // Gross comes from the deal's rep commission record (if any) for split math
    const [dc] = await db.select().from(dealCommissions)
      .where(and(eq(dealCommissions.dealId, body.dealId), eq(dealCommissions.companyId, ctx.companyId))).limit(1);
    const gross = dc ? Number(dc.grossCommission) : 0;

    const commissionAmount = computeLeadSourceCommission({
      grossCommission: gross,
      splitPct: body.splitPct ?? null,
      flatAmount: body.flatAmount ?? null,
    });

    const values = {
      companyId: ctx.companyId,
      dealId: body.dealId,
      leadSourceId: body.leadSourceId,
      splitPct: body.splitPct != null ? String(body.splitPct) : null,
      flatAmount: body.flatAmount != null ? String(body.flatAmount) : null,
      commissionAmount: String(commissionAmount),
      notes: body.notes ?? null,
      syncState: 'pending' as const,
      updatedAt: new Date(),
    };

    const [existing] = await db.select().from(leadSourceCommissions)
      .where(and(
        eq(leadSourceCommissions.dealId, body.dealId),
        eq(leadSourceCommissions.leadSourceId, body.leadSourceId),
        eq(leadSourceCommissions.companyId, ctx.companyId),
      )).limit(1);

    let row;
    if (existing) {
      [row] = await db.update(leadSourceCommissions).set(values).where(eq(leadSourceCommissions.id, existing.id)).returning();
    } else {
      [row] = await db.insert(leadSourceCommissions).values(values).returning();
    }
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true, commission: row });
  } catch (e) { return apiError(e); }
}
