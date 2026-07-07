import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { fundedApprovals, deals, users, dealCommissions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { computeRepCommission } from '@/lib/commissions/calc';
import { notifyUsers } from '@/lib/notify';
import { triggerSync } from '@/lib/sheets/sync';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  // On approve the admin can modify any of the details before they apply.
  dealId: z.string().uuid().optional().nullable(),
  dealName: z.string().max(300).optional().nullable(),
  repId: z.string().uuid().optional().nullable(),
  fundedAmount: z.coerce.number().nonnegative().optional().nullable(),
  factorRate: z.coerce.number().nonnegative().optional().nullable(),
  termDetails: z.string().max(200).optional().nullable(),
  funderName: z.string().max(200).optional().nullable(),
  grossCommission: z.coerce.number().nonnegative().optional().nullable(),
  repSplitPct: z.coerce.number().min(0).max(100).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

/**
 * PATCH /api/funded-approvals/[id] — admin reviews a pending approval.
 *
 * approve: applies everything in one go —
 *   1. the deal is marked funded (created first if the approval wasn't
 *      linked to an existing deal), with amount/rate/funder/date,
 *   2. the rep is assigned to the deal,
 *   3. a commission record is created for the rep (gross × split),
 *   4. the rep + submitter get notified.
 * reject: marks the approval rejected; nothing else changes.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, companyId } = await requireCompanyAdmin();
    const [approval] = await db.select().from(fundedApprovals)
      .where(and(eq(fundedApprovals.id, params.id), eq(fundedApprovals.companyId, companyId)))
      .limit(1);
    if (!approval) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (approval.status !== 'pending') {
      return NextResponse.json({ error: 'This approval was already reviewed.' }, { status: 400 });
    }

    const body = reviewSchema.parse(await req.json());
    const now = new Date();

    if (body.action === 'reject') {
      await db.update(fundedApprovals)
        .set({ status: 'rejected', reviewedBy: user.id, reviewedAt: now, updatedAt: now })
        .where(eq(fundedApprovals.id, approval.id));
      notifyUsers(companyId, [approval.submittedBy], {
        title: 'Funded deal not approved',
        body: `${user.name || user.email} did not approve the funded log${approval.dealName ? ` for "${approval.dealName}"` : ''}.`,
        link: '/portfolio',
      }, user.id).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    // ---- APPROVE: merge admin-modified values over the submitted ones ----
    const dealId = body.dealId !== undefined ? body.dealId : approval.dealId;
    const dealName = (body.dealName ?? approval.dealName ?? '').trim();
    const repId = body.repId !== undefined ? body.repId : approval.repId;
    const fundedAmount = body.fundedAmount !== undefined ? body.fundedAmount : (approval.fundedAmount != null ? Number(approval.fundedAmount) : null);
    const factorRate = body.factorRate !== undefined ? body.factorRate : (approval.factorRate != null ? Number(approval.factorRate) : null);
    const funderName = body.funderName !== undefined ? body.funderName : approval.funderName;
    const grossCommission = body.grossCommission !== undefined ? body.grossCommission : (approval.grossCommission != null ? Number(approval.grossCommission) : null);
    const repSplitPct = body.repSplitPct !== undefined ? body.repSplitPct : (approval.repSplitPct != null ? Number(approval.repSplitPct) : null);
    const notes = body.notes !== undefined ? body.notes : approval.notes;

    // Rep guard (if admin changed it)
    if (repId) {
      const [r] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, repId), eq(users.companyId, companyId))).limit(1);
      if (!r) return NextResponse.json({ error: 'Rep not in this company' }, { status: 400 });
    }

    // 1+2. Mark the deal funded (create it if needed) + assign the rep.
    let finalDealId = dealId ?? null;
    if (finalDealId) {
      const [d] = await db.select().from(deals)
        .where(and(eq(deals.id, finalDealId), eq(deals.companyId, companyId), eq(deals.isDeleted, false))).limit(1);
      if (!d) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      await db.update(deals).set({
        status: 'funded',
        assignedRepId: repId ?? d.assignedRepId,
        fundedAmount: fundedAmount != null ? String(fundedAmount) : d.fundedAmount,
        factorRate: factorRate != null ? String(factorRate) : d.factorRate,
        fundedWithName: funderName ?? d.fundedWithName,
        fundingDate: d.fundingDate ?? now,
        fundedNotes: notes ?? d.fundedNotes,
        updatedAt: now,
      }).where(eq(deals.id, finalDealId));
    } else {
      if (!dealName) return NextResponse.json({ error: 'A deal name is required to log a funded deal.' }, { status: 400 });
      const [created] = await db.insert(deals).values({
        companyId,
        name: dealName,
        status: 'funded',
        assignedRepId: repId ?? null,
        fundedAmount: fundedAmount != null ? String(fundedAmount) : null,
        factorRate: factorRate != null ? String(factorRate) : null,
        fundedWithName: funderName ?? null,
        fundingDate: now,
        fundedNotes: notes ?? null,
        createdBy: user.id,
      }).returning();
      finalDealId = created.id;
    }

    // 3. Commission record for the rep (only when there's money attached).
    if (grossCommission != null && grossCommission > 0) {
      const split = repSplitPct ?? 100;
      const { totalRepCommission } = computeRepCommission({
        grossCommission,
        repSplitPct: split,
        brokerFee: 0,
      });
      await db.insert(dealCommissions).values({
        companyId,
        dealId: finalDealId,
        repId: repId ?? null,
        fundedAmount: fundedAmount != null ? String(fundedAmount) : null,
        rate: factorRate != null ? String(factorRate) : null,
        grossCommission: String(grossCommission),
        repSplitPct: String(split),
        repCommissionAmount: String(totalRepCommission),
        fundingDate: now,
        notes: notes ?? null,
        syncState: 'pending',
        updatedAt: now,
      });
    }

    await db.update(fundedApprovals)
      .set({
        status: 'approved',
        dealId: finalDealId,
        dealName: dealName || approval.dealName,
        repId: repId ?? null,
        fundedAmount: fundedAmount != null ? String(fundedAmount) : null,
        factorRate: factorRate != null ? String(factorRate) : null,
        funderName: funderName ?? null,
        grossCommission: grossCommission != null ? String(grossCommission) : null,
        repSplitPct: repSplitPct != null ? String(repSplitPct) : null,
        notes: notes ?? null,
        reviewedBy: user.id,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(fundedApprovals.id, approval.id));

    // 4. Tell the rep + the submitter it's official.
    notifyUsers(companyId, [repId, approval.submittedBy], {
      title: `Funded deal approved: ${dealName || 'deal'}`,
      body: `${user.name || user.email} approved the funded log${grossCommission ? ' — your commission has been added' : ''}.`,
      link: `/portfolio?deal=${finalDealId}`,
    }, user.id).catch(() => {});

    triggerSync(companyId);
    return NextResponse.json({ ok: true, dealId: finalDealId });
  } catch (e) { return apiError(e); }
}
