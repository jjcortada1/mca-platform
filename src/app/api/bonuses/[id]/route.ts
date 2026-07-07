import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { funderBonuses } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { fromDateInput } from '@/lib/dates';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  funderName: z.string().min(1).max(200).optional(),
  bonus: z.string().min(1).max(4000).optional(),
  conditions: z.string().max(4000).optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  isRunning: z.boolean().optional(),
});

/** PATCH — edit a bonus. Admin only. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId } = await requireCompanyAdmin();
    const [row] = await db.select().from(funderBonuses)
      .where(and(eq(funderBonuses.id, params.id), eq(funderBonuses.companyId, companyId), eq(funderBonuses.isDeleted, false)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = patchSchema.parse(await req.json());
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.funderName !== undefined) updates.funderName = body.funderName.trim();
    if (body.bonus !== undefined) updates.bonus = body.bonus.trim();
    if (body.conditions !== undefined) updates.conditions = body.conditions?.trim() || null;
    if (body.isRunning !== undefined) {
      updates.isRunning = body.isRunning;
      if (body.isRunning) { updates.startDate = null; updates.endDate = null; }
    }
    if (body.startDate !== undefined) updates.startDate = body.startDate ? fromDateInput(body.startDate) : null;
    if (body.endDate !== undefined) updates.endDate = body.endDate ? fromDateInput(body.endDate) : null;
    await db.update(funderBonuses).set(updates).where(eq(funderBonuses.id, row.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/** DELETE — soft-delete a bonus. Admin only. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { companyId } = await requireCompanyAdmin();
    await db.update(funderBonuses)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(eq(funderBonuses.id, params.id), eq(funderBonuses.companyId, companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
