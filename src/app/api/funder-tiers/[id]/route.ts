import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { funderTiers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { createTierSchema } from '@/lib/validation/schemas';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!hasPermission(ctx.user, 'funders.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = createTierSchema.partial().parse(await req.json());
    await db.update(funderTiers).set(body)
      .where(and(eq(funderTiers.id, params.id), eq(funderTiers.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!hasPermission(ctx.user, 'funders.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.delete(funderTiers)
      .where(and(eq(funderTiers.id, params.id), eq(funderTiers.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
