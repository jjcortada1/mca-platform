import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { infoEntries } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { infoEntrySchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!hasPermission(ctx.user, 'info.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = infoEntrySchema.partial().parse(await req.json());
    await db.update(infoEntries).set({ ...body, updatedAt: new Date() })
      .where(and(eq(infoEntries.id, params.id), eq(infoEntries.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!hasPermission(ctx.user, 'info.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.delete(infoEntries)
      .where(and(eq(infoEntries.id, params.id), eq(infoEntries.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
