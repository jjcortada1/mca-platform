import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { leadSourceCommissions } from '@/lib/db/schema';
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
