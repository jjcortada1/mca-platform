import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, dealSyndications, users } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { dealSyndicationInputSchema } from '@/lib/validation/schemas';
import { fromDateInput } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Syndication management per deal.
 *
 *   GET   /api/deals/[id]/syndications  → list (with rep names joined)
 *   POST  /api/deals/[id]/syndications  → add a syndication record
 *
 * Admin-only (commissions.manage). Reps can SEE syndications on deals
 * they're assigned to via the funded-deals UI, but creating them and
 * editing them is admin-only — same authority model as the rest of
 * commission/payout records.
 */

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
}

async function verifyDealOwnership(dealId: string, companyId: string) {
  const [row] = await db.select({ id: deals.id, companyId: deals.companyId, isDeleted: deals.isDeleted })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.companyId, companyId)))
    .limit(1);
  if (!row || row.isDeleted) return null;
  return row;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const deal = await verifyDealOwnership(params.id, ctx.companyId);
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });

    // For non-admin reps: only return syndications visible to them. The
    // current behavior is "the assigned rep on the deal sees all
    // syndications", since the syndication panel sits on the funded-deal
    // expand which is rep-visible. If we later want to restrict reps to
    // seeing only their OWN syndications on a deal, narrow here.
    const rows = await db.select({
      s: dealSyndications,
      repName: users.name,
    })
      .from(dealSyndications)
      .leftJoin(users, eq(users.id, dealSyndications.repId))
      .where(and(
        eq(dealSyndications.dealId, params.id),
        eq(dealSyndications.companyId, ctx.companyId),
        eq(dealSyndications.isDeleted, false),
      ))
      .orderBy(desc(dealSyndications.createdAt));

    return NextResponse.json({
      syndications: rows.map((r) => ({
        id: r.s.id,
        dealId: r.s.dealId,
        repId: r.s.repId,
        repName: r.repName,
        syndicatedAmount: r.s.syndicatedAmount,
        syndicatedDate: r.s.syndicatedDate,
        notes: r.s.notes,
        createdAt: r.s.createdAt,
        updatedAt: r.s.updatedAt,
      })),
    });
  } catch (e) { return apiError(e); }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const deal = await verifyDealOwnership(params.id, ctx.companyId);
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });

    const body = dealSyndicationInputSchema.parse(await req.json());

    // Verify the rep belongs to this company — defense in depth so an
    // admin can't accidentally (or maliciously) attach a rep ID from
    // another tenant.
    const [rep] = await db.select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, body.repId), eq(users.companyId, ctx.companyId)))
      .limit(1);
    if (!rep) return NextResponse.json({ error: 'Rep not in this company' }, { status: 400 });

    const [row] = await db.insert(dealSyndications).values({
      companyId: ctx.companyId,
      dealId: params.id,
      repId: body.repId,
      syndicatedAmount: String(body.syndicatedAmount),
      syndicatedDate: body.syndicatedDate ? fromDateInput(body.syndicatedDate) ?? new Date() : new Date(),
      notes: body.notes ?? null,
    }).returning();

    return NextResponse.json({ syndication: row }, { status: 201 });
  } catch (e) { return apiError(e); }
}
