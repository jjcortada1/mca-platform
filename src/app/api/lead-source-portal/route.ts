import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { leadSourceCommissions, leadSources, commissionPayments, deals } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { rollupTotals, resolveAutoStatus } from '@/lib/commissions/calc';

export const runtime = 'nodejs';

/**
 * GET /api/lead-source-portal
 *
 * For the logged-in LEAD SOURCE user only. Returns ONLY their payout figures —
 * amount owed, paid, pending, status, and a minimal payment history. It exposes
 * NO deal details, merchant info, funder info, funded amounts, rates, fees, or
 * rep commission data. This is the privacy-restricted view per spec.
 */
export async function GET() {
  try {
    const user = await requireUser();
    if (user.role !== 'lead_source') {
      return NextResponse.json({ error: 'This portal is for lead source accounts only.' }, { status: 403 });
    }

    // Find the lead source linked to this login
    const [ls] = await db.select().from(leadSources).where(eq(leadSources.userId, user.id)).limit(1);
    if (!ls) {
      return NextResponse.json({ error: 'No lead source profile linked to this account.' }, { status: 404 });
    }

    // Select LS commission fields + the parent deal's funding date — but NOT
    // any merchant or deal identifying data (no name, no merchant, no funder).
    const rows = await db.select({
      id: leadSourceCommissions.id,
      commissionAmount: leadSourceCommissions.commissionAmount,
      paidAmount: leadSourceCommissions.paidAmount,
      status: leadSourceCommissions.status,
      earlyPayoffDiscount: leadSourceCommissions.earlyPayoffDiscount,
      notes: leadSourceCommissions.notes,
      updatedAt: leadSourceCommissions.updatedAt,
      isDeleted: leadSourceCommissions.isDeleted,
      // Funding date lives on the LS commission itself.
      fundingDate: leadSourceCommissions.fundingDate,
    })
      .from(leadSourceCommissions)
      .where(and(
        eq(leadSourceCommissions.leadSourceId, ls.id),
        eq(leadSourceCommissions.isDeleted, false),
      ));

    const now = new Date();
    // Critical: pass the RESOLVED status (not raw DB status) into rollupTotals
    // so commissions that have aged past the 30-day clearing window are
    // counted as available even if the DB row still says 'pending'. Without
    // this, available balance stays at $0 even when the lead source has
    // money waiting to be paid out.
    const totals = rollupTotals(rows.map((r) => ({
      amount: Number(r.commissionAmount),
      paid: Number(r.paidAmount),
      status: resolveAutoStatus(r.status, r.fundingDate, now),
    })));

    // Payment history per LS commission row — amounts + status + funded date
    // + notes + early payoff. No deal name / merchant ever.
    const history = rows
      .map((r) => ({
        id: r.id,
        amountOwed: Number(r.commissionAmount),
        amountPaid: Number(r.paidAmount),
        status: r.status, // 'pending' | 'cleared' | 'clawed_back'
        clawedBack: r.status === 'clawed_back',
        fundingDate: r.fundingDate,
        earlyPayoffDiscount: r.earlyPayoffDiscount,
        notes: r.notes,
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Actual logged payments — amount, date, method only. NO deal/merchant data.
    // Excludes payments that were soft-deleted (e.g. when admin removed the
    // parent LS commission).
    const paymentRows = await db.select({
      amount: commissionPayments.amount,
      paidDate: commissionPayments.paidDate,
      method: commissionPayments.method,
    })
      .from(commissionPayments)
      .where(and(
        eq(commissionPayments.leadSourceId, ls.id),
        eq(commissionPayments.isDeleted, false),
      ))
      .orderBy(desc(commissionPayments.paidDate));
    const payments = paymentRows.map((p) => ({
      amount: Number(p.amount),
      paidDate: p.paidDate,
      method: p.method,
    }));

    return NextResponse.json({
      leadSourceName: ls.name,
      totals,
      history,  // commission-level history (amounts + status)
      payments, // actual paid amounts logged
    });
  } catch (e) { return apiError(e); }
}
