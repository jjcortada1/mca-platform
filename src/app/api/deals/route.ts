import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, users } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { upsertDealSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';
import { triggerSync } from '@/lib/sheets/sync';

// Deal edits / deletions must reflect immediately in every dropdown across
// the app. No caching of this endpoint.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    // Hard rule: deleted deals never appear in any list, dropdown, or
    // downstream view. They stay in the DB (audit trail) but are filtered
    // out at every read.
    const list = await db.select().from(deals)
      .where(and(eq(deals.companyId, ctx.companyId), eq(deals.isDeleted, false)))
      .orderBy(desc(deals.createdAt));
    return NextResponse.json({ deals: list, data: list });
  } catch (e) { return apiError(e); }
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
      offerAmount: body.offerAmount != null ? String(body.offerAmount) : null,
      assignedRepId: body.assignedRepId ?? null,
      // New deals default to 'submitted' (modern enum); legacy 'shopping' kept
      // only for existing rows. Caller may still send 'shopping' explicitly.
      status: body.status ?? 'submitted',
      createdBy: ctx.user.id,
    }).returning();
    triggerSync(ctx.companyId);
    return NextResponse.json({ deal: d });
  } catch (e) { return apiError(e); }
}
