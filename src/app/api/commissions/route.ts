import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { dealCommissions, deals, users } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { triggerSync } from '@/lib/sheets/sync';
import { computeRepCommission, resolveAutoStatus } from '@/lib/commissions/calc';
import { z } from 'zod';

export const runtime = 'nodejs';

/**
 * GET /api/commissions
 * Admin (commissions.manage): all commissions for the company.
 * Rep (commissions.view): only their own.
 * Lead-source role: forbidden here (they use the lead-source portal).
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') {
      return NextResponse.json({ error: 'Not available for this account' }, { status: 403 });
    }
    const isAdmin = hasPermission(ctx.user, 'commissions.manage') || ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';
    // Non-admins must have the commissions.view permission toggled on.
    if (!isAdmin && !hasPermission(ctx.user, 'commissions.view')) {
      return NextResponse.json({ error: 'You do not have access to commissions.' }, { status: 403 });
    }

    const rows = await db
      .select({
        c: dealCommissions,
        dealName: deals.name,
        merchantFirstName: deals.merchantFirstName,
        merchantLastName: deals.merchantLastName,
        merchantPhone: deals.merchantPhone,
        merchantEmail: deals.merchantEmail,
        assignedRepId: deals.assignedRepId,
        repName: users.name,
      })
      .from(dealCommissions)
      .innerJoin(deals, eq(deals.id, dealCommissions.dealId))
      .leftJoin(users, eq(users.id, dealCommissions.repId))
      .where(
        isAdmin
          ? and(eq(dealCommissions.companyId, ctx.companyId), eq(dealCommissions.isDeleted, false))
          : and(eq(dealCommissions.companyId, ctx.companyId), eq(dealCommissions.isDeleted, false), eq(dealCommissions.repId, ctx.user.id))
      )
      .orderBy(desc(dealCommissions.updatedAt));

    const now = new Date();
    const data = rows.map(({ c, dealName, merchantFirstName, merchantLastName, merchantPhone, merchantEmail, assignedRepId, repName }) => {
      const effectiveStatus = resolveAutoStatus(c.status, c.fundingDate, now);
      const amount = Number(c.repCommissionAmount);
      const paid = Number(c.paidAmount);
      return {
        id: c.id,
        dealId: c.dealId,
        dealName,
        // Joined deal fields exposed individually so the edit panel can prefill.
        merchantFirstName, merchantLastName,
        merchantName: [merchantFirstName, merchantLastName].filter(Boolean).join(' ') || null,
        merchantPhone, merchantEmail,
        assignedRepId,
        repId: c.repId, repName,
        fundedAmount: c.fundedAmount, rate: c.rate, termMonths: c.termMonths,
        termMode: c.termMode, termCount: c.termCount,
        fees: c.fees, brokerFee: c.brokerFee,
        grossCommission: c.grossCommission,
        repSplitPct: c.repSplitPct,
        repCommissionAmount: c.repCommissionAmount,
        paidAmount: c.paidAmount,
        pendingAmount: effectiveStatus === 'pending' ? Math.max(0, amount - paid) : 0,
        owedAmount: effectiveStatus === 'clawed_back' ? 0 : Math.max(0, amount - paid),
        status: effectiveStatus,
        fundingDate: c.fundingDate,
        clearedDate: c.clearedDate,
        earlyPayoffDiscount: c.earlyPayoffDiscount,
        notes: c.notes,
        syncState: c.syncState,
        updatedAt: c.updatedAt,
      };
    });

    return NextResponse.json({ commissions: data, data });
  } catch (e) { return apiError(e); }
}

const upsertSchema = z.object({
  dealId: z.string().uuid(),
  repId: z.string().uuid().nullable().optional(),
  fundedAmount: z.coerce.number().nonnegative().optional().nullable(),
  rate: z.coerce.number().nonnegative().optional().nullable(),
  termMonths: z.coerce.number().nonnegative().optional().nullable(),
  termMode: z.enum(['daily', 'weekly']).optional().nullable(),
  termCount: z.coerce.number().nonnegative().optional().nullable(),
  fees: z.coerce.number().nonnegative().optional().nullable(),
  brokerFee: z.coerce.number().nonnegative().optional().nullable(),
  grossCommission: z.coerce.number().nonnegative().default(0),
  repSplitPct: z.coerce.number().min(0).max(100).default(0),
  fundingDate: z.string().optional().nullable(),
  earlyPayoffDiscount: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * POST /api/commissions
 * Admin-only. Creates or updates (by dealId) the rep commission for a deal.
 * Recomputes rep commission amount from gross + split% (+ same split on broker fee).
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!(hasPermission(ctx.user, 'commissions.manage') || ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin')) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    const body = upsertSchema.parse(await req.json());

    // Tenant guard on the deal
    const [deal] = await db.select().from(deals).where(eq(deals.id, body.dealId)).limit(1);
    if (!deal || deal.companyId !== ctx.companyId) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }
    // Rep guard
    if (body.repId) {
      const [rep] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, body.repId), eq(users.companyId, ctx.companyId))).limit(1);
      if (!rep) return NextResponse.json({ error: 'Rep not in this company' }, { status: 400 });
    }

    const { totalRepCommission } = computeRepCommission({
      grossCommission: body.grossCommission,
      repSplitPct: body.repSplitPct,
      brokerFee: body.brokerFee ?? 0,
    });

    const values = {
      companyId: ctx.companyId,
      dealId: body.dealId,
      repId: body.repId ?? null,
      fundedAmount: body.fundedAmount != null ? String(body.fundedAmount) : null,
      rate: body.rate != null ? String(body.rate) : null,
      termMonths: body.termMonths != null ? String(body.termMonths) : null,
      termMode: body.termMode ?? null,
      termCount: body.termCount != null ? String(body.termCount) : null,
      fees: body.fees != null ? String(body.fees) : null,
      brokerFee: body.brokerFee != null ? String(body.brokerFee) : null,
      grossCommission: String(body.grossCommission),
      repSplitPct: String(body.repSplitPct),
      repCommissionAmount: String(totalRepCommission),
      fundingDate: body.fundingDate ? new Date(body.fundingDate) : null,
      earlyPayoffDiscount: body.earlyPayoffDiscount ?? null,
      notes: body.notes ?? null,
      syncState: 'pending' as const,
      updatedAt: new Date(),
    };

    // Each logged commission is its own permanent record. Never overwrite an
    // existing one — admin must use the PATCH /[id] endpoint to modify.
    const [row] = await db.insert(dealCommissions).values(values).returning();

    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true, commission: row });
  } catch (e) { return apiError(e); }
}
