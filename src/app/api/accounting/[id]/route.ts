import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { accountingEntries } from '@/lib/db/schema';
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
  dealId: z.string().uuid().nullable().optional(),
  entryType: z.enum(['received', 'sent_back']).optional(),
  amount: z.coerce.number().positive().optional(),
  entryDate: z.string().optional().nullable(),
  method: z.enum(['ach', 'wire', 'check', 'cash', 'zelle', 'other']).optional().nullable(),
  referenceNumber: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = patchSchema.parse(await req.json());

    const [row] = await db.select().from(accountingEntries)
      .where(and(eq(accountingEntries.id, params.id), eq(accountingEntries.companyId, ctx.companyId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.dealId !== undefined) updates.dealId = body.dealId;
    if (body.entryType !== undefined) updates.entryType = body.entryType;
    if (body.amount !== undefined) updates.amount = String(body.amount);
    if (body.entryDate !== undefined) updates.entryDate = body.entryDate ? fromDateInput(body.entryDate) ?? new Date() : new Date();
    if (body.method !== undefined) updates.method = body.method;
    if (body.referenceNumber !== undefined) updates.referenceNumber = body.referenceNumber;
    if (body.notes !== undefined) updates.notes = body.notes;

    await db.update(accountingEntries).set(updates).where(and(eq(accountingEntries.id, params.id), eq(accountingEntries.companyId, ctx.companyId)));
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const [row] = await db.select().from(accountingEntries)
      .where(and(eq(accountingEntries.id, params.id), eq(accountingEntries.companyId, ctx.companyId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.update(accountingEntries)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(and(eq(accountingEntries.id, params.id), eq(accountingEntries.companyId, ctx.companyId)));
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
