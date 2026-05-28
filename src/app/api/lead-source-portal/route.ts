import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { leadSourceCommissions, leadSources } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { rollupTotals } from '@/lib/commissions/calc';

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

    const rows = await db.select({
      id: leadSourceCommissions.id,
      commissionAmount: leadSourceCommissions.commissionAmount,
      paidAmount: leadSourceCommissions.paidAmount,
      status: leadSourceCommissions.status,
      updatedAt: leadSourceCommissions.updatedAt,
      isDeleted: leadSourceCommissions.isDeleted,
    })
      .from(leadSourceCommissions)
      .where(and(
        eq(leadSourceCommissions.leadSourceId, ls.id),
        eq(leadSourceCommissions.isDeleted, false),
      ));

    const totals = rollupTotals(rows.map((r) => ({
      amount: Number(r.commissionAmount),
      paid: Number(r.paidAmount),
      status: r.status,
    })));

    // Payment history: ONLY amounts + status + date. No deal identifiers.
    const history = rows
      .map((r) => ({
        amountOwed: Number(r.commissionAmount),
        amountPaid: Number(r.paidAmount),
        status: r.status,
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return NextResponse.json({
      leadSourceName: ls.name,
      totals,   // { total, paid, pending, owed, clawedBack }
      history,  // amounts + status only — no merchant/deal data
    });
  } catch (e) { return apiError(e); }
}
