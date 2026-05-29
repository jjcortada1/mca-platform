import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { commissionPayments, dealCommissions, leadSourceCommissions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
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

    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
