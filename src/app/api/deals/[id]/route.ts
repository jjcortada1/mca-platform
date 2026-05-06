import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, users } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, requirePermission } from '@/lib/auth/context';
import { upsertDealSchema } from '@/lib/validation/schemas';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const [d] = await db.select().from(deals)
      .where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId))).limit(1);
    if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deal: d });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('deals.edit');
    const body = upsertDealSchema.partial().parse(await req.json());

    // Verify assignedRepId is in this company
    if (body.assignedRepId) {
      const [rep] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, body.assignedRepId), eq(users.companyId, ctx.companyId))).limit(1);
      if (!rep) return NextResponse.json({ error: 'Assigned rep not in this company' }, { status: 400 });
    }

    const updates: any = { ...body, updatedAt: new Date() };
    if (updates.merchantEmail === '') updates.merchantEmail = null;
    await db.update(deals).set(updates)
      .where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

// Some clients send PUT instead of PATCH — accept both
export const PUT = PATCH;

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('deals.edit');
    await db.delete(deals).where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
