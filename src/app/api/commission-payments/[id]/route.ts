import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { commissionPayments, dealCommissions, leadSourceCommissions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';
import { fromDateInput } from '@/lib/dates';
import { triggerSync } from '@/lib/sheets/sync';

export const runtime = 'nodejs';

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
}

const patchSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  paidDate: z.string().optional().nullable(),
  method: z.enum(['ach', 'wire', 'check', 'cash', 'zelle', 'other']).optional().nullable(),
  confirmationNumber: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // Re-link (or unlink) to a specific deal commission / LS commission.
  dealCommissionId: z.string().uuid().optional().nullable(),
  leadSourceCommissionId: z.string().uuid().optional().nullable(),
});

/**
 * PATCH /api/commission-payments/[id]
 * Admin edits a logged payment. If the amount changes (or the parent commission
 * changes), the linked commission's paidAmount is adjusted to stay in sync.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = patchSchema.parse(await req.json());

    const [row] = await db.select().from(commissionPayments)
      .where(and(eq(commissionPayments.id, params.id), eq(commissionPayments.companyId, ctx.companyId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (row.isDeleted) return NextResponse.json({ error: 'Payment was deleted' }, { status: 400 });

    const oldAmount = Number(row.amount);
    const newAmount = body.amount !== undefined ? body.amount : oldAmount;
    const oldDealCommissionId = row.dealCommissionId;
    const newDealCommissionId = body.dealCommissionId !== undefined ? body.dealCommissionId : oldDealCommissionId;
    const oldLscId = row.leadSourceCommissionId;
    const newLscId = body.leadSourceCommissionId !== undefined ? body.leadSourceCommissionId : oldLscId;

    // Reverse old paidAmount bumps on whichever commission the payment was linked to.
    if (oldDealCommissionId) {
      const [dc] = await db.select().from(dealCommissions)
        .where(and(eq(dealCommissions.id, oldDealCommissionId), eq(dealCommissions.companyId, ctx.companyId))).limit(1);
      if (dc) {
        await db.update(dealCommissions)
          .set({ paidAmount: String(Math.max(0, Number(dc.paidAmount) - oldAmount)), updatedAt: new Date() })
          .where(eq(dealCommissions.id, dc.id));
      }
    }
    if (oldLscId) {
      const [lsc] = await db.select().from(leadSourceCommissions)
        .where(and(eq(leadSourceCommissions.id, oldLscId), eq(leadSourceCommissions.companyId, ctx.companyId))).limit(1);
      if (lsc) {
        await db.update(leadSourceCommissions)
          .set({ paidAmount: String(Math.max(0, Number(lsc.paidAmount) - oldAmount)), updatedAt: new Date(), syncState: 'pending' })
          .where(eq(leadSourceCommissions.id, lsc.id));
      }
    }

    // Apply the new paidAmount bumps to whichever the payment is now linked to.
    if (newDealCommissionId) {
      const [dc] = await db.select().from(dealCommissions)
        .where(and(eq(dealCommissions.id, newDealCommissionId), eq(dealCommissions.companyId, ctx.companyId))).limit(1);
      if (dc) {
        await db.update(dealCommissions)
          .set({ paidAmount: String(Number(dc.paidAmount) + newAmount), updatedAt: new Date() })
          .where(eq(dealCommissions.id, dc.id));
      }
    }
    if (newLscId) {
      const [lsc] = await db.select().from(leadSourceCommissions)
        .where(and(eq(leadSourceCommissions.id, newLscId), eq(leadSourceCommissions.companyId, ctx.companyId))).limit(1);
      if (lsc) {
        // Also auto-set leadSourceId for portal scoping.
        await db.update(leadSourceCommissions)
          .set({ paidAmount: String(Number(lsc.paidAmount) + newAmount), updatedAt: new Date(), syncState: 'pending' })
          .where(eq(leadSourceCommissions.id, lsc.id));
      }
    }

    // Update the payment row itself.
    const updates: Record<string, unknown> = {};
    if (body.amount !== undefined) updates.amount = String(body.amount);
    if (body.paidDate !== undefined) updates.paidDate = body.paidDate ? fromDateInput(body.paidDate) ?? new Date() : new Date();
    if (body.method !== undefined) updates.method = body.method;
    if (body.confirmationNumber !== undefined) updates.confirmationNumber = body.confirmationNumber;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.dealCommissionId !== undefined) updates.dealCommissionId = body.dealCommissionId;
    if (body.leadSourceCommissionId !== undefined) {
      updates.leadSourceCommissionId = body.leadSourceCommissionId;
      // Re-resolve leadSourceId if a new LSC is being linked.
      if (body.leadSourceCommissionId) {
        const [lsc] = await db.select().from(leadSourceCommissions)
          .where(and(eq(leadSourceCommissions.id, body.leadSourceCommissionId), eq(leadSourceCommissions.companyId, ctx.companyId))).limit(1);
        if (lsc) updates.leadSourceId = lsc.leadSourceId;
      } else {
        updates.leadSourceId = null;
      }
    }
    if (Object.keys(updates).length) {
      await db.update(commissionPayments).set(updates).where(eq(commissionPayments.id, params.id));
    }

    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/**
 * DELETE /api/commission-payments/[id]
 * Soft-deletes a payment so it's preserved in the backup but hidden from the
 * lead source portal and reps. Reverses its effect on the parent commission's
 * paidAmount.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const [row] = await db.select().from(commissionPayments)
      .where(and(eq(commissionPayments.id, params.id), eq(commissionPayments.companyId, ctx.companyId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (row.isDeleted) return NextResponse.json({ ok: true, alreadyDeleted: true });

    await db.update(commissionPayments).set({ isDeleted: true }).where(eq(commissionPayments.id, params.id));

    // Reverse the paid-amount bump that was applied when the payment was logged.
    const amt = Number(row.amount);
    if (row.dealCommissionId) {
      const [dc] = await db.select().from(dealCommissions)
        .where(and(eq(dealCommissions.id, row.dealCommissionId), eq(dealCommissions.companyId, ctx.companyId)))
        .limit(1);
      if (dc) {
        const newPaid = Math.max(0, Number(dc.paidAmount) - amt);
        await db.update(dealCommissions)
          .set({ paidAmount: String(newPaid), updatedAt: new Date() })
          .where(eq(dealCommissions.id, dc.id));
      }
    }
    if (row.leadSourceCommissionId) {
      const [lsc] = await db.select().from(leadSourceCommissions)
        .where(and(eq(leadSourceCommissions.id, row.leadSourceCommissionId), eq(leadSourceCommissions.companyId, ctx.companyId)))
        .limit(1);
      if (lsc) {
        const newPaid = Math.max(0, Number(lsc.paidAmount) - amt);
        await db.update(leadSourceCommissions)
          .set({ paidAmount: String(newPaid), updatedAt: new Date(), syncState: 'pending' })
          .where(eq(leadSourceCommissions.id, lsc.id));
      }
    }

    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
