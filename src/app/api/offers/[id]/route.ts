import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, dealOffers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { ensureDealAccess } from '@/lib/auth/deal-access';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Edit or delete one offer.
 *
 *   PATCH  /api/offers/[id]   → partial update
 *   DELETE /api/offers/[id]   → remove the offer
 *
 * Ownership is checked by joining offer → deal → company, THEN applying the
 * same rep/team scoping as the deal itself (ensureDealAccess) — a rep who
 * knows a teammate's offer or deal id must not be able to edit it.
 */

async function loadOfferOwnedBy(offerId: string, companyId: string) {
  const [row] = await db
    .select({
      offer: dealOffers,
      dealCompanyId: deals.companyId,
      dealId: deals.id,
    })
    .from(dealOffers)
    .innerJoin(deals, eq(deals.id, dealOffers.dealId))
    .where(and(eq(dealOffers.id, offerId), eq(deals.companyId, companyId)))
    .limit(1);
  return row;
}

const patchSchema = z.object({
  fundingAmount: z.union([z.coerce.number().nonnegative(), z.literal(''), z.null()]).optional(),
  factorRate: z.union([z.coerce.number().nonnegative(), z.literal(''), z.null()]).optional(),
  termCount: z.union([z.coerce.number().int().nonnegative(), z.literal(''), z.null()]).optional(),
  termMode: z.enum(['days', 'weeks', 'months']).nullable().optional(),
  fees: z.union([z.coerce.number().nonnegative(), z.literal(''), z.null()]).optional(),
  paymentAmount: z.union([z.coerce.number().nonnegative(), z.literal(''), z.null()]).optional(),
  notes: z.string().max(2000).nullable().optional(),
  funderId: z.string().uuid().nullable().optional(),
  isAccepted: z.boolean().optional(),
  isReverseConsolidation: z.boolean().optional(),
});

function num(v: unknown): string | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('active_deals.edit');
    const owned = await loadOfferOwnedBy(params.id, ctx.companyId);
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const access = await ensureDealAccess(ctx, owned.dealId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const body = patchSchema.parse(await req.json());

    // Acceptance is exclusive — clear it on every other offer of this deal
    // before flipping the chosen one. Skipped when isAccepted is being
    // explicitly turned OFF (no need to clear others).
    if (body.isAccepted === true) {
      await db.update(dealOffers)
        .set({ isAccepted: false })
        .where(eq(dealOffers.dealId, owned.dealId));
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if ('fundingAmount' in body) patch.fundingAmount = num(body.fundingAmount);
    if ('factorRate' in body) patch.factorRate = num(body.factorRate);
    if ('termCount' in body) patch.termCount = body.termCount === '' || body.termCount == null ? null : Number(body.termCount);
    if ('termMode' in body) patch.termMode = body.termMode ?? null;
    if ('fees' in body) patch.fees = num(body.fees);
    if ('paymentAmount' in body) patch.paymentAmount = num(body.paymentAmount);
    if ('notes' in body) patch.notes = body.notes ?? null;
    if ('funderId' in body) patch.funderId = body.funderId ?? null;
    if ('isAccepted' in body) patch.isAccepted = body.isAccepted;
    if ('isReverseConsolidation' in body) patch.isReverseConsolidation = body.isReverseConsolidation;

    const [updated] = await db.update(dealOffers)
      .set(patch)
      .where(eq(dealOffers.id, params.id))
      .returning();

    // Mirror an accepted offer onto the legacy deal columns.
    if (updated.isAccepted) {
      await db.update(deals).set({
        offerAmount: updated.fundingAmount,
        offerNotes: updated.notes,
        updatedAt: new Date(),
      }).where(eq(deals.id, owned.dealId));
    }

    return NextResponse.json({ data: updated });
  } catch (e) { return apiError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('active_deals.edit');
    const owned = await loadOfferOwnedBy(params.id, ctx.companyId);
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const access = await ensureDealAccess(ctx, owned.dealId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    await db.delete(dealOffers).where(eq(dealOffers.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
