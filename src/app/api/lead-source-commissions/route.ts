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
        leadSourceName: leadSources.name,
      })
      .from(leadSourceCommissions)
      .innerJoin(deals, eq(deals.id, leadSourceCommissions.dealId))
      .innerJoin(leadSources, eq(leadSources.id, leadSourceCommissions.leadSourceId))
      .where(and(eq(leadSourceCommissions.companyId, ctx.companyId), eq(leadSourceCommissions.isDeleted, false)))
      .orderBy(desc(leadSourceCommissions.updatedAt));

    const now = new Date();
    const data = rows.map((r) => {
      const amt = Number(r.lsc.commissionAmount);
      const paid = Number(r.lsc.paidAmount);
      const status = resolveAutoStatus(r.lsc.status, null, now);
      return {
        id: r.lsc.id,
        dealId: r.lsc.dealId,
        dealName: r.dealName,
        merchantName: [r.merchantFirstName, r.merchantLastName].filter(Boolean).join(' ') || null,
        leadSourceId: r.lsc.leadSourceId,
        leadSourceName: r.leadSourceName,
        // All math values come from the LS commission row itself.
        fundingDate: r.lsc.fundingDate,
        grossCommission: r.lsc.grossCommission,
        brokerFee: r.lsc.brokerFee,
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
  grossCommission: z.coerce.number().nonnegative().optional().nullable(),
  brokerFee: z.coerce.number().nonnegative().optional().nullable(),
  fundingDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * POST /api/lead-source-commissions
 * Admin. Upsert (by deal + lead source). Computes owed as:
 *   - flat amount, OR
 *   - splitPct × (grossCommission + brokerFee)
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

    // The LS commission is a self-contained record. Gross / broker fee / funding
    // date live on the LS row itself — they are NEVER written back to the deal
    // or to the rep commission record. Selecting an existing deal just links
    // by ID; the original deal stays exactly as it was.
    const gross = body.grossCommission != null ? body.grossCommission : 0;
    const brokerFee = body.brokerFee != null ? body.brokerFee : 0;

    let commissionAmount = 0;
    if (body.flatAmount != null && body.flatAmount > 0) commissionAmount = body.flatAmount;
    else if (body.splitPct != null && body.splitPct > 0) commissionAmount = Math.round((gross + brokerFee) * (body.splitPct / 100) * 100) / 100;

    const values = {
      companyId: ctx.companyId,
      dealId: body.dealId,
      leadSourceId: body.leadSourceId,
      splitPct: body.splitPct != null ? String(body.splitPct) : null,
      flatAmount: body.flatAmount != null ? String(body.flatAmount) : null,
      grossCommission: body.grossCommission != null ? String(body.grossCommission) : null,
      brokerFee: body.brokerFee != null ? String(body.brokerFee) : null,
      fundingDate: body.fundingDate ? new Date(body.fundingDate) : null,
      commissionAmount: String(commissionAmount),
      notes: body.notes ?? null,
      syncState: 'pending' as const,
      updatedAt: new Date(),
    };

    // Each logged commission is its own permanent record. Never overwrite an
    // existing one — that would silently destroy history. Admin must use the
    // PATCH /api/lead-source-commissions/[id] endpoint to modify one.
    const [row] = await db.insert(leadSourceCommissions).values(values).returning();
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true, commission: row });
  } catch (e) { return apiError(e); }
}
