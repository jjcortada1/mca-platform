import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, users } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { upsertDealSchema } from '@/lib/validation/schemas';

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const list = await db.select().from(deals)
      .where(eq(deals.companyId, ctx.companyId)).orderBy(desc(deals.createdAt));
    return NextResponse.json({ deals: list, data: list });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    // Either deals.shop (rep creating during shop flow) OR deals.edit (admin/manual create)
    if (!hasPermission(ctx.user, 'deals.shop') && !hasPermission(ctx.user, 'deals.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = upsertDealSchema.parse(await req.json());

    // Verify assignedRepId is in this company
    if (body.assignedRepId) {
      const [rep] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, body.assignedRepId), eq(users.companyId, ctx.companyId))).limit(1);
      if (!rep) return NextResponse.json({ error: 'Assigned rep not in this company' }, { status: 400 });
    }

    const [d] = await db.insert(deals).values({
      companyId: ctx.companyId,
      name: body.name,
      merchantFirstName: body.merchantFirstName ?? null,
      merchantLastName: body.merchantLastName ?? null,
      merchantEmail: body.merchantEmail || null,
      merchantPhone: body.merchantPhone ?? null,
      offerNotes: body.offerNotes ?? null,
      assignedRepId: body.assignedRepId ?? null,
      status: body.status ?? 'shopping',
      createdBy: ctx.user.id,
    }).returning();
    return NextResponse.json({ deal: d });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
