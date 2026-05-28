import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { dealCommissions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { triggerSync } from '@/lib/sheets/sync';
import { z } from 'zod';

export const runtime = 'nodejs';

function isAdmin(user: SessionUser) {
  return user.role === 'company_admin' || user.role === 'master_admin' || hasPermission(user, 'commissions.manage');
}

const patchSchema = z.object({
  status: z.enum(['pending', 'cleared', 'clawed_back']).optional(),
  paidAmount: z.coerce.number().nonnegative().optional(),
  clearedDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * PATCH /api/commissions/[id]
 * Admin: update status, paid amount, cleared date, notes. Marks row for re-sync.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    const body = patchSchema.parse(await req.json());

    const [row] = await db.select().from(dealCommissions)
      .where(and(eq(dealCommissions.id, params.id), eq(dealCommissions.companyId, ctx.companyId))).limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updates: Record<string, unknown> = { syncState: 'pending', updatedAt: new Date() };
    if (body.status !== undefined) {
      updates.status = body.status;
      // When manually cleared, stamp clearedDate if not provided
      if (body.status === 'cleared' && !body.clearedDate && !row.clearedDate) {
        updates.clearedDate = new Date();
      }
    }
    if (body.paidAmount !== undefined) updates.paidAmount = String(body.paidAmount);
    if (body.clearedDate !== undefined) updates.clearedDate = body.clearedDate ? new Date(body.clearedDate) : null;
    if (body.notes !== undefined) updates.notes = body.notes;

    await db.update(dealCommissions).set(updates).where(eq(dealCommissions.id, params.id));
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/**
 * DELETE /api/commissions/[id]
 * SOFT delete only — sets isDeleted=true so the external Sheet backup can mark it
 * inactive rather than removing the row. Never hard-deletes.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    const [row] = await db.select().from(dealCommissions)
      .where(and(eq(dealCommissions.id, params.id), eq(dealCommissions.companyId, ctx.companyId))).limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.update(dealCommissions)
      .set({ isDeleted: true, syncState: 'pending', updatedAt: new Date() })
      .where(eq(dealCommissions.id, params.id));
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true, softDeleted: true });
  } catch (e) { return apiError(e); }
}
