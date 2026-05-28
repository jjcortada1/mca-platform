import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, users } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, requirePermission } from '@/lib/auth/context';
import { upsertDealSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const [d] = await db.select().from(deals)
      .where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId))).limit(1);
    if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ deal: d });
  } catch (e) { return apiError(e); }
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
    // offerAmount is numeric in the DB; allow empty string → null
    if (updates.offerAmount === '' || updates.offerAmount === undefined) {
      // leave undefined (no-op) or null if explicitly empty string
      if (updates.offerAmount === '') updates.offerAmount = null;
    } else if (updates.offerAmount != null) {
      updates.offerAmount = String(updates.offerAmount);
    }
    await db.update(deals).set(updates)
      .where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

// Some clients send PUT instead of PATCH — accept both
export const PUT = PATCH;

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('deals.edit');
    await db.delete(deals).where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
