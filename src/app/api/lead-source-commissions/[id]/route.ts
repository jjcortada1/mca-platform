import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { leadSourceCommissions, dealCommissions, deals } from '@/lib/db/schema';
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

    // Resolve current commission math, falling back to existing values.
    const newSplit = body.splitPct !== undefined ? body.splitPct : (row.splitPct ? Number(row.splitPct) : null);
    const newFlat = body.flatAmount !== undefined ? body.flatAmount : (row.flatAmount ? Number(row.flatAmount) : null);
    if (body.splitPct !== undefined) updates.splitPct = newSplit !== null ? String(newSplit) : null;
    if (body.flatAmount !== undefined) updates.flatAmount = newFlat !== null ? String(newFlat) : null;

    // If gross/brokerFee provided OR split/flat changed, recompute commissionAmount.
    if (body.grossCommission !== undefined || body.brokerFee !== undefined
        || body.splitPct !== undefined || body.flatAmount !== undefined) {
      // Pull the linked rep commission for this deal so we can grab gross/brokerFee
      // if the caller didn't provide them.
      const [rep] = await db.select().from(dealCommissions)
        .where(and(eq(dealCommissions.dealId, row.dealId), eq(dealCommissions.isDeleted, false)))
        .limit(1);
      const gross = body.grossCommission !== undefined ? body.grossCommission : (rep ? Number(rep.grossCommission) : 0);
      const brokerFee = body.brokerFee !== undefined ? body.brokerFee : (rep ? Number(rep.brokerFee) : 0);

      // If grossCommission/brokerFee passed in, also propagate to the rep row
      // so the math stays consistent on both sides.
      if ((body.grossCommission !== undefined || body.brokerFee !== undefined) && rep) {
        const repSplit = Number(rep.repSplitPct) || 0;
        await db.update(dealCommissions).set({
          grossCommission: String(gross),
          brokerFee: String(brokerFee),
          repCommissionAmount: String(Math.round((gross + brokerFee) * (repSplit / 100) * 100) / 100),
          syncState: 'pending', updatedAt: new Date(),
        }).where(eq(dealCommissions.id, rep.id));
      }

      let owed = 0;
      if (newFlat !== null && newFlat > 0) owed = newFlat;
      else if (newSplit !== null && newSplit > 0) owed = Math.round((gross + brokerFee) * (newSplit / 100) * 100) / 100;
      updates.commissionAmount = String(owed);
    }

    // Funding date — store on the deal so the LS portal can show it.
    if (body.fundingDate !== undefined) {
      const fd = body.fundingDate ? new Date(body.fundingDate) : null;
      await db.update(deals).set({ fundingDate: fd })
        .where(and(eq(deals.id, row.dealId), eq(deals.companyId, ctx.companyId)));
    }

    await db.update(leadSourceCommissions).set(updates).where(eq(leadSourceCommissions.id, params.id));
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
      .where(eq(leadSourceCommissions.id, params.id));
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true, softDeleted: true });
  } catch (e) { return apiError(e); }
}
