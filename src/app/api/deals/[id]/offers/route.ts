import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, dealOffers } from '@/lib/db/schema';
import { and, eq, desc, asc } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Multi-offer tracking for one deal.
 *
 *   GET   /api/deals/[id]/offers  → all offers, oldest first (the natural
 *                                   collection order makes the compare view
 *                                   read left-to-right chronologically)
 *   POST  /api/deals/[id]/offers  → add a new offer
 *
 * Ownership: only deals owned by the requester's company are accessible.
 */

async function verifyOwnership(dealId: string, companyId: string) {
  const [row] = await db.select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.companyId, companyId)))
    .limit(1);
  return !!row;
}

const createSchema = z.object({
  fundingAmount: z.union([z.coerce.number().nonnegative(), z.literal('')]).optional().nullable(),
  factorRate: z.union([z.coerce.number().nonnegative(), z.literal('')]).optional().nullable(),
  termCount: z.union([z.coerce.number().int().nonnegative(), z.literal('')]).optional().nullable(),
  termMode: z.enum(['days', 'weeks', 'months']).optional().nullable(),
  fees: z.union([z.coerce.number().nonnegative(), z.literal('')]).optional().nullable(),
  paymentAmount: z.union([z.coerce.number().nonnegative(), z.literal('')]).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  funderId: z.string().uuid().optional().nullable(),
  isAccepted: z.boolean().optional(),
  isReverseConsolidation: z.boolean().optional(),
});

/** Coerce numeric input (which may be '' from a blank field) into the numeric|null
 *  shape Drizzle expects. Empty strings become null so we don't poison the DB
 *  with non-numeric values. */
function num(v: unknown): string | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('active_deals.view');
    if (!(await verifyOwnership(params.id, ctx.companyId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const rows = await db.select().from(dealOffers)
      .where(eq(dealOffers.dealId, params.id))
      .orderBy(asc(dealOffers.createdAt));
    return NextResponse.json({ data: rows });
  } catch (e) { return apiError(e); }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('active_deals.edit');
    if (!(await verifyOwnership(params.id, ctx.companyId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = createSchema.parse(await req.json());

    // If this offer is being marked accepted, clear the flag on any other
    // offer for the same deal so there's only ever one accepted offer.
    if (body.isAccepted) {
      await db.update(dealOffers)
        .set({ isAccepted: false })
        .where(eq(dealOffers.dealId, params.id));
    }

    const [row] = await db.insert(dealOffers).values({
      dealId: params.id,
      fundingAmount: num(body.fundingAmount),
      factorRate: num(body.factorRate),
      termCount: body.termCount === '' || body.termCount == null ? null : Number(body.termCount),
      termMode: body.termMode ?? null,
      fees: num(body.fees),
      paymentAmount: num(body.paymentAmount),
      notes: body.notes ?? null,
      funderId: body.funderId ?? null,
      isAccepted: body.isAccepted ?? false,
      isReverseConsolidation: body.isReverseConsolidation ?? false,
    }).returning();

    // Mirror an accepted offer onto the deal's legacy single-offer columns
    // so older code that reads deal.offerAmount keeps working. Only the
    // fields we have map nicely.
    if (row.isAccepted) {
      await db.update(deals).set({
        offerAmount: row.fundingAmount,
        offerNotes: row.notes,
        updatedAt: new Date(),
      }).where(eq(deals.id, params.id));
    }

    return NextResponse.json({ data: row });
  } catch (e) { return apiError(e); }
}
