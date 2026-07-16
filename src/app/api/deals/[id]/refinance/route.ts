import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, funders } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { ensureDealAccess } from '@/lib/auth/deal-access';
import { apiError } from '@/lib/api/errors';
import { fromDateInput } from '@/lib/dates';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/deals/[id]/refinance — refinance a funded deal IN PLACE.
 *
 * What happens, atomically from the user's point of view:
 *   1. A NEW deal is created directly as FUNDED (it never passes through
 *      Active Deals) with all merchant info carried over from the original
 *      and only the new funding details taken from the request.
 *   2. The new deal is linked back via refinancedFromDealId.
 *   3. The ORIGINAL deal STAYS in Funded Deals, marked
 *      fundedSubStatus='refinanced' (terminal — excluded from refi-ready),
 *      with its balance treated as paid off through the refinance.
 *
 * The new deal counts as a new funded deal (per the owner's decision).
 * Commissions are NOT auto-created — same as every other funding path;
 * they're logged via the approvals queue or the commissions admin.
 */

const schema = z.object({
  fundedAmount: z.coerce.number().positive(),
  factorRate: z.coerce.number().min(1).max(3),
  feePct: z.coerce.number().min(0).max(50).optional().nullable(),
  termMode: z.enum(['daily', 'weekly']),
  termCount: z.coerce.number().positive().max(2000),
  fundingDate: z.string().optional().nullable(), // YYYY-MM-DD
  fundedWithFunderId: z.string().uuid().optional().nullable(),
  fundedWithName: z.string().max(200).optional().nullable(),
  fundedNotes: z.string().max(5000).optional().nullable(),
  /** Payoff amount applied to close the original deal (recorded in its notes). */
  payoffAmount: z.coerce.number().nonnegative().optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('deals.edit');
    const access = await ensureDealAccess(ctx, params.id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const [old] = await db.select().from(deals)
      .where(and(eq(deals.id, params.id), eq(deals.companyId, ctx.companyId), eq(deals.isDeleted, false)))
      .limit(1);
    if (!old) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!['funded', 'paid_off', 'closed'].includes(old.status)) {
      return NextResponse.json({ error: 'Only a funded deal can be refinanced.' }, { status: 400 });
    }
    if (old.fundedSubStatus === 'refinanced') {
      return NextResponse.json({ error: 'This deal was already refinanced.' }, { status: 400 });
    }

    const body = schema.parse(await req.json());

    // Funder (if given) must belong to this company.
    if (body.fundedWithFunderId) {
      const [f] = await db.select({ id: funders.id }).from(funders)
        .where(and(eq(funders.id, body.fundedWithFunderId), eq(funders.companyId, ctx.companyId)))
        .limit(1);
      if (!f) return NextResponse.json({ error: 'Funder not found in this company.' }, { status: 400 });
    }

    const fundingDate = body.fundingDate ? fromDateInput(body.fundingDate) ?? new Date() : new Date();
    const newName = /\(refi/i.test(old.name) ? `${old.name} +` : `${old.name} (Refi)`;

    // 1) The NEW funded deal — merchant info carried over, funding fresh.
    const [created] = await db.insert(deals).values({
      companyId: ctx.companyId,
      name: newName,
      merchantFirstName: old.merchantFirstName,
      merchantLastName: old.merchantLastName,
      merchantEmail: old.merchantEmail,
      merchantPhone: old.merchantPhone,
      assignedRepId: old.assignedRepId,
      dealType: old.dealType,
      status: 'funded',
      fundedSubStatus: 'active',
      fundedAmount: String(body.fundedAmount),
      factorRate: String(body.factorRate),
      feePct: body.feePct != null ? String(body.feePct) : null,
      termMode: body.termMode,
      termCount: String(body.termCount),
      fundingDate,
      fundedWithFunderId: body.fundedWithFunderId ?? null,
      fundedWithName: body.fundedWithName?.trim() || null,
      fundedNotes: body.fundedNotes?.trim() || null,
      refinancedFromDealId: old.id,
      // Carry the shopping context so re-shopping later starts informed.
      submissionIntake: old.submissionIntake,
    }).returning();

    // 2) Close out the ORIGINAL: stays in Funded Deals, marked refinanced,
    //    balance treated as collected in full through the refi payoff.
    const oldPayback = old.fundedAmount && old.factorRate
      ? Math.round(Number(old.fundedAmount) * Number(old.factorRate) * 100) / 100
      : null;
    const stamp = fundingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const note = `Refinanced into "${created.name}" on ${stamp}` +
      (body.payoffAmount ? ` — payoff $${Number(body.payoffAmount).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '') + '.';
    await db.update(deals).set({
      fundedSubStatus: 'refinanced',
      ...(oldPayback !== null ? { amountCollected: String(oldPayback) } : {}),
      renewalNotes: old.renewalNotes ? `${old.renewalNotes}\n${note}` : note,
      updatedAt: new Date(),
    }).where(and(eq(deals.id, old.id), eq(deals.companyId, ctx.companyId)));

    // Notify the rep (best-effort) that their deal was refinanced.
    try {
      if (old.assignedRepId && old.assignedRepId !== ctx.user.id) {
        const { notifyUsers } = await import('@/lib/notify');
        notifyUsers(ctx.companyId, [old.assignedRepId], {
          title: `Deal refinanced: ${old.name}`,
          body: `New funding $${body.fundedAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} @ ${body.factorRate}`,
          link: `/portfolio`,
        }, ctx.user.id).catch(() => {});
      }
    } catch { /* best-effort */ }

    return NextResponse.json({ data: created });
  } catch (e) { return apiError(e); }
}
