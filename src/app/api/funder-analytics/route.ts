import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  funders, submissions, submissionFunders, deals, dealOffers,
} from '@/lib/db/schema';
import { and, eq, inArray, gte } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/funder-analytics?days=90 — per-funder performance intel built
 * entirely from data the CRM already records (nothing new to type):
 *
 *   submissions sent  → submission_funders rows (per-funder status)
 *   offers made       → deal_offers (amount, factor, accepted)
 *   deals WON         → deals.funded_with_funder_id + funded volume
 *
 * ?days=N limits to activity in the last N days (omit = all time).
 * Company-scoped; requires funders.view (same gate as the funder directory).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission('funders.view');
    const daysRaw = Number(req.nextUrl.searchParams.get('days'));
    const since = Number.isFinite(daysRaw) && daysRaw > 0
      ? new Date(Date.now() - Math.min(daysRaw, 3650) * 86_400_000)
      : null;

    const funderRows = await db.select({
      id: funders.id, name: funders.name, isActive: funders.isActive,
    }).from(funders).where(eq(funders.companyId, ctx.companyId));
    if (!funderRows.length) return NextResponse.json({ data: { funders: [], totals: null } });
    const funderIds = funderRows.map((f) => f.id);

    // Submission outcomes per funder (scoped via the submission's company).
    const subRows = await db.select({
      funderId: submissionFunders.funderId,
      status: submissionFunders.status,
      submittedAt: submissionFunders.submittedAt,
    })
      .from(submissionFunders)
      .innerJoin(submissions, eq(submissions.id, submissionFunders.submissionId))
      .where(and(
        eq(submissions.companyId, ctx.companyId),
        inArray(submissionFunders.funderId, funderIds),
        ...(since ? [gte(submissionFunders.submittedAt, since)] : []),
      ));

    // Offers per funder (scoped via the deal's company).
    const offerRows = await db.select({
      funderId: dealOffers.funderId,
      fundingAmount: dealOffers.fundingAmount,
      factorRate: dealOffers.factorRate,
      isAccepted: dealOffers.isAccepted,
      createdAt: dealOffers.createdAt,
    })
      .from(dealOffers)
      .innerJoin(deals, eq(deals.id, dealOffers.dealId))
      .where(and(
        eq(deals.companyId, ctx.companyId),
        inArray(dealOffers.funderId, funderIds),
        ...(since ? [gte(dealOffers.createdAt, since)] : []),
      ));

    // Wins: funded deals attributed to a funder.
    const wonRows = await db.select({
      funderId: deals.fundedWithFunderId,
      fundedAmount: deals.fundedAmount,
      fundingDate: deals.fundingDate,
    })
      .from(deals)
      .where(and(
        eq(deals.companyId, ctx.companyId),
        eq(deals.isDeleted, false),
        inArray(deals.fundedWithFunderId, funderIds),
        ...(since ? [gte(deals.fundingDate, since)] : []),
      ));

    interface Agg {
      submissions: number; approved: number; declined: number; noResponse: number;
      offers: number; offersAccepted: number; offerVolume: number; factorSum: number; factorN: number;
      wins: number; wonVolume: number;
    }
    const agg = new Map<string, Agg>();
    const get = (id: string): Agg => {
      let a = agg.get(id);
      if (!a) {
        a = { submissions: 0, approved: 0, declined: 0, noResponse: 0, offers: 0, offersAccepted: 0, offerVolume: 0, factorSum: 0, factorN: 0, wins: 0, wonVolume: 0 };
        agg.set(id, a);
      }
      return a;
    };

    for (const r of subRows) {
      if (!r.funderId) continue;
      const a = get(r.funderId);
      a.submissions++;
      if (r.status === 'approved') a.approved++;
      else if (r.status === 'declined') a.declined++;
      else a.noResponse++;
    }
    for (const r of offerRows) {
      if (!r.funderId) continue;
      const a = get(r.funderId);
      a.offers++;
      if (r.isAccepted) a.offersAccepted++;
      const amt = Number(r.fundingAmount);
      if (Number.isFinite(amt)) a.offerVolume += amt;
      const fr = Number(r.factorRate);
      if (Number.isFinite(fr) && fr > 0) { a.factorSum += fr; a.factorN++; }
    }
    for (const r of wonRows) {
      if (!r.funderId) continue;
      const a = get(r.funderId);
      a.wins++;
      const amt = Number(r.fundedAmount);
      if (Number.isFinite(amt)) a.wonVolume += amt;
    }

    const data = funderRows.map((f) => {
      const a = agg.get(f.id);
      return {
        funderId: f.id,
        name: f.name,
        isActive: f.isActive,
        submissions: a?.submissions ?? 0,
        approved: a?.approved ?? 0,
        declined: a?.declined ?? 0,
        noResponse: a?.noResponse ?? 0,
        approvalRate: a && a.submissions > 0 ? Math.round((a.approved / a.submissions) * 100) : null,
        offers: a?.offers ?? 0,
        offersAccepted: a?.offersAccepted ?? 0,
        avgOffer: a && a.offers > 0 && a.offerVolume > 0 ? Math.round(a.offerVolume / a.offers) : null,
        avgFactor: a && a.factorN > 0 ? Math.round((a.factorSum / a.factorN) * 1000) / 1000 : null,
        wins: a?.wins ?? 0,
        wonVolume: a?.wonVolume ?? 0,
        winRate: a && a.submissions > 0 ? Math.round((a.wins / a.submissions) * 100) : null,
      };
    })
      // Funders with any activity first, most wins → most submissions.
      .sort((x, y) => (y.wins - x.wins) || (y.wonVolume - x.wonVolume) || (y.submissions - x.submissions));

    const totals = {
      submissions: data.reduce((s, f) => s + f.submissions, 0),
      approved: data.reduce((s, f) => s + f.approved, 0),
      offers: data.reduce((s, f) => s + f.offers, 0),
      wins: data.reduce((s, f) => s + f.wins, 0),
      wonVolume: data.reduce((s, f) => s + f.wonVolume, 0),
    };

    return NextResponse.json({ data: { funders: data, totals } });
  } catch (e) { return apiError(e); }
}
