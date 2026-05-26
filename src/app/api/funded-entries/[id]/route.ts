import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { fundedEntries } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { fundedEntrySchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const body = fundedEntrySchema.partial().parse(await req.json());

    const [existing] = await db.select().from(fundedEntries)
      .where(and(eq(fundedEntries.id, params.id), eq(fundedEntries.companyId, ctx.companyId))).limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Reps can only edit their own entries
    if (ctx.user.role === 'rep' && existing.repId !== ctx.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updates: any = {};
    if (body.dealInitials !== undefined) updates.dealInitials = body.dealInitials;
    if (body.amountFunded !== undefined) updates.amountFunded = String(body.amountFunded);
    if (body.fundedDate !== undefined) updates.fundedDate = new Date(body.fundedDate);
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.repId !== undefined && ctx.user.role === 'company_admin') updates.repId = body.repId;

    if (Object.keys(updates).length) {
      await db.update(fundedEntries).set(updates)
        .where(and(eq(fundedEntries.id, params.id), eq(fundedEntries.companyId, ctx.companyId)));
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const [existing] = await db.select().from(fundedEntries)
      .where(and(eq(fundedEntries.id, params.id), eq(fundedEntries.companyId, ctx.companyId))).limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (ctx.user.role === 'rep' && existing.repId !== ctx.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.delete(fundedEntries)
      .where(and(eq(fundedEntries.id, params.id), eq(fundedEntries.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
