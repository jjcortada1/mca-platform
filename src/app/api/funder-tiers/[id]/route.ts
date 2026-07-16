import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { funderTiers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { createTierSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';

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
  } catch (e) { return apiError(e); }
}

/**
 * PUT — alias of PATCH. The Settings tier editor has always sent PUT while
 * only PATCH existed, so renames were silently failing with 405.
 */
export const PUT = PATCH;

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!hasPermission(ctx.user, 'funders.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.delete(funderTiers)
      .where(and(eq(funderTiers.id, params.id), eq(funderTiers.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
