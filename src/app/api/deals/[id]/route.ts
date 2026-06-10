import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, users, dealCommissions, leadSourceCommissions, accountingEntries, commissionPayments } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, requirePermission } from '@/lib/auth/context';
import { upsertDealSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';
import { fromDateInput } from '@/lib/dates';
import { triggerSync } from '@/lib/sheets/sync';

/**
 * Returns true when the given user is allowed to read/write the given deal.
 * Admins (master_admin / company_admin) bypass the check. Reps and other
 * non-admins must be the deal's assignedRepId. Lead-source accounts can't
 * touch deals here at all — they use the lead-source portal.
 *
 * Centralized so every handler in this file applies the SAME rule (defense
 * in depth — the GET, PATCH, and DELETE handlers historically allowed any
 * authenticated user with the right permission flag to touch any deal in
 * the company).
 */
async function ensureDealAccess(
  ctx: Awaited<ReturnType<typeof requireTenantContext>>,
  dealId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [d] = await db
    .select({ id: deals.id, assignedRepId: deals.assignedRepId })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.companyId, ctx.companyId), eq(deals.isDeleted, false)))
    .limit(1);
  if (!d) return { ok: false, status: 404, error: 'Not found' };
  const isAdmin = ctx.user.role === 'master_admin' || ctx.user.role === 'company_admin';
  if (isAdmin) return { ok: true };
  if (ctx.user.role === 'lead_source') return { ok: false, status: 403, error: 'Forbidden' };
  // Non-admin: must own this deal.
  if (d.assignedRepId === ctx.user.id) return { ok: true };
  // Returning 404 (not 403) on purpose — don't reveal that the deal exists
  // to someone who isn't supposed to see it.
  return { ok: false, status: 404, error: 'Not found' };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const access = await ensureDealAccess(ctx, params.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const [d] = await db.select().from(deals)
      .where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId), eq(deals.isDeleted, false))).limit(1);
    return NextResponse.json({ deal: d });
  } catch (e) { return apiError(e); }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('deals.edit');
    // Same scope check as GET — having `deals.edit` permission isn't enough,
    // the rep also has to be the assigned owner of THIS specific deal.
    const access = await ensureDealAccess(ctx, params.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = upsertDealSchema.partial().parse(await req.json());

    // Non-admins can't reassign deals to other reps — that's an admin
    // function. Strip the field if a rep tries to pass it.
    const isAdmin = ctx.user.role === 'master_admin' || ctx.user.role === 'company_admin';
    if (!isAdmin && body.assignedRepId !== undefined && body.assignedRepId !== ctx.user.id) {
      return NextResponse.json({ error: 'Only admins can reassign deals.' }, { status: 403 });
    }

    // Verify assignedRepId is in this company
    if (body.assignedRepId) {
      const [rep] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, body.assignedRepId), eq(users.companyId, ctx.companyId))).limit(1);
      if (!rep) return NextResponse.json({ error: 'Assigned rep not in this company' }, { status: 400 });
    }

    const updates: any = { ...body, updatedAt: new Date() };
    if (updates.merchantEmail === '') updates.merchantEmail = null;

    // Numeric columns: '' → null, numbers → string (Drizzle numeric wants string).
    for (const k of ['offerAmount', 'fundedAmount', 'netAmount', 'feePct', 'factorRate', 'termCount', 'amountCollected'] as const) {
      if (updates[k] === '' ) updates[k] = null;
      else if (updates[k] != null) updates[k] = String(updates[k]);
    }
    // Funding date: '' → null, string → Date
    if (updates.fundingDate === '') updates.fundingDate = null;
    else if (updates.fundingDate != null) updates.fundingDate = fromDateInput(String(updates.fundingDate)) ?? new Date();

    await db.update(deals).set(updates)
      .where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId)));

    // If the assigned rep changed, propagate to all commission records for this
    // deal so the rep's commission view, leaderboard, and "funded by" all match.
    if (body.assignedRepId !== undefined) {
      await db.update(dealCommissions)
        .set({ repId: body.assignedRepId || null, syncState: 'pending', updatedAt: new Date() })
        .where(and(eq(dealCommissions.dealId, params.id), eq(dealCommissions.companyId, ctx.companyId)));
    }

    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

// Some clients send PUT instead of PATCH — accept both
export const PUT = PATCH;

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('deals.edit');
    // Only admins can delete deals. A rep with the deals.edit permission can
    // still edit their own deals, but deletion is a destructive admin action.
    const isAdmin = ctx.user.role === 'master_admin' || ctx.user.role === 'company_admin';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only admins can delete deals.' }, { status: 403 });
    }
    const access = await ensureDealAccess(ctx, params.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    // Soft-delete the deal AND every dependent record so it disappears from
    // every list, dropdown, commission view, accounting page, lead source
    // portal, and rep view. We never hard-delete here — historical audit
    // data is preserved for accounting/legal review.
    const now = new Date();
    await db.update(deals)
      .set({ isDeleted: true, updatedAt: now })
      .where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId)));

    // Cascade soft-delete on every downstream record. Each table has its
    // own isDeleted column; we set them all in one batch so the deal is
    // truly gone from every query that filters on isDeleted=false.
    await db.update(dealCommissions)
      .set({ isDeleted: true, syncState: 'pending', updatedAt: now })
      .where(and(eq(dealCommissions.dealId, params.id), eq(dealCommissions.companyId, ctx.companyId)));
    await db.update(leadSourceCommissions)
      .set({ isDeleted: true, syncState: 'pending', updatedAt: now })
      .where(and(eq(leadSourceCommissions.dealId, params.id), eq(leadSourceCommissions.companyId, ctx.companyId)));
    await db.update(accountingEntries)
      .set({ isDeleted: true, updatedAt: now })
      .where(and(eq(accountingEntries.dealId, params.id), eq(accountingEntries.companyId, ctx.companyId)));
    // Payments linked to this deal's commissions get soft-deleted too. Since
    // payments don't carry a dealId directly we filter via the parent
    // commission ids we just marked deleted.
    const dcIds = await db.select({ id: dealCommissions.id }).from(dealCommissions)
      .where(and(eq(dealCommissions.dealId, params.id), eq(dealCommissions.companyId, ctx.companyId)));
    const lscIds = await db.select({ id: leadSourceCommissions.id }).from(leadSourceCommissions)
      .where(and(eq(leadSourceCommissions.dealId, params.id), eq(leadSourceCommissions.companyId, ctx.companyId)));
    for (const { id } of dcIds) {
      await db.update(commissionPayments)
        .set({ isDeleted: true })
        .where(and(eq(commissionPayments.dealCommissionId, id), eq(commissionPayments.companyId, ctx.companyId)));
    }
    for (const { id } of lscIds) {
      await db.update(commissionPayments)
        .set({ isDeleted: true })
        .where(and(eq(commissionPayments.leadSourceCommissionId, id), eq(commissionPayments.companyId, ctx.companyId)));
    }

    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
