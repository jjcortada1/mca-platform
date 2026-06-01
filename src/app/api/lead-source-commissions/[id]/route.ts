import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { leadSourceCommissions, dealCommissions, deals, commissionPayments } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { triggerSync } from '@/lib/sheets/sync';
import { z } from 'zod';

export const runtime = 'nodejs';

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
}

const patchSchema = z.object({
  status: z.enum(['pending', 'cleared', 'clawed_back']).optional(),
  paidAmount: z.coerce.number().nonnegative().optional(),
  earlyPayoffDiscount: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // Editable math — recompute commissionAmount when these change
  splitPct: z.coerce.number().min(0).max(100).optional().nullable(),
  flatAmount: z.coerce.number().nonnegative().optional().nullable(),
  grossCommission: z.coerce.number().nonnegative().optional(),
  brokerFee: z.coerce.number().nonnegative().optional(),
  fundingDate: z.string().optional().nullable(),
});

/** PATCH /api/lead-source-commissions/[id] — admin edits a lead source commission. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = patchSchema.parse(await req.json());

    const [row] = await db.select().from(leadSourceCommissions)
      .where(and(eq(leadSourceCommissions.id, params.id), eq(leadSourceCommissions.companyId, ctx.companyId))).limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updates: Record<string, unknown> = { syncState: 'pending', updatedAt: new Date() };
    if (body.status !== undefined) updates.status = body.status;
    if (body.paidAmount !== undefined) updates.paidAmount = String(body.paidAmount);
    if (body.earlyPayoffDiscount !== undefined) updates.earlyPayoffDiscount = body.earlyPayoffDiscount;
    if (body.notes !== undefined) updates.notes = body.notes;

    // All math fields are local to the LS commission row. The parent deal and
    // rep commission are never modified by edits here.
    if (body.grossCommission !== undefined) updates.grossCommission = body.grossCommission != null ? String(body.grossCommission) : null;
    if (body.brokerFee !== undefined) updates.brokerFee = body.brokerFee != null ? String(body.brokerFee) : null;
    if (body.fundingDate !== undefined) updates.fundingDate = body.fundingDate ? new Date(body.fundingDate) : null;
    if (body.splitPct !== undefined) updates.splitPct = body.splitPct != null ? String(body.splitPct) : null;
    if (body.flatAmount !== undefined) updates.flatAmount = body.flatAmount != null ? String(body.flatAmount) : null;

    // Recompute commissionAmount whenever any math input changes.
    const anyMathChanged = body.grossCommission !== undefined || body.brokerFee !== undefined
      || body.splitPct !== undefined || body.flatAmount !== undefined;
    if (anyMathChanged) {
      const gross = body.grossCommission !== undefined ? (body.grossCommission ?? 0) : Number(row.grossCommission ?? 0);
      const brokerFee = body.brokerFee !== undefined ? (body.brokerFee ?? 0) : Number(row.brokerFee ?? 0);
      const newSplit = body.splitPct !== undefined ? body.splitPct : (row.splitPct ? Number(row.splitPct) : null);
      const newFlat = body.flatAmount !== undefined ? body.flatAmount : (row.flatAmount ? Number(row.flatAmount) : null);
      let owed = 0;
      if (newFlat !== null && newFlat > 0) owed = newFlat;
      else if (newSplit !== null && newSplit > 0) owed = Math.round((gross + brokerFee) * (newSplit / 100) * 100) / 100;
      updates.commissionAmount = String(owed);
    }

    await db.update(leadSourceCommissions).set(updates).where(and(eq(leadSourceCommissions.id, params.id), eq(leadSourceCommissions.companyId, ctx.companyId)));
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/**
 * DELETE /api/lead-source-commissions/[id]
 * Soft-delete only — preserves backup history.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const [row] = await db.select().from(leadSourceCommissions)
      .where(and(eq(leadSourceCommissions.id, params.id), eq(leadSourceCommissions.companyId, ctx.companyId))).limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.update(leadSourceCommissions)
      .set({ isDeleted: true, syncState: 'pending', updatedAt: new Date() })
      .where(and(eq(leadSourceCommissions.id, params.id), eq(leadSourceCommissions.companyId, ctx.companyId)));

    // Cascade: any payments logged against this LS commission are also marked
    // deleted so they no longer appear in the lead source's portal.
    // Filter by companyId on the cascade too — defense in depth.
    await db.update(commissionPayments)
      .set({ isDeleted: true })
      .where(and(eq(commissionPayments.leadSourceCommissionId, params.id), eq(commissionPayments.companyId, ctx.companyId)));

    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true, softDeleted: true });
  } catch (e) { return apiError(e); }
}
