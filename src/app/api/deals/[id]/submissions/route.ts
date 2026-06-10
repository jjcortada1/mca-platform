import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { submissions, submissionFunders, deals, funders } from '@/lib/db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

/**
 * Per-deal submissions endpoint.
 *
 * Returns every funder this deal has already been submitted to, with the
 * latest status + date. Used by the Deal Shop "Already Submitted" bucket
 * so the user can see at a glance who's already seen this file (and avoid
 * shopping it to the same funder twice).
 *
 * Shape:
 *   {
 *     data: [
 *       { funderId, funderName, status, submittedAt }
 *     ]
 *   }
 *
 * Manual (off-directory) funders are EXCLUDED — they have no funderId so
 * the deal-shop UI can't cross-reference them against its funder list. The
 * /submissions page still shows them in the full audit view.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('submissions.view');

    // Verify the deal belongs to this tenant AND (for non-admins) is
    // assigned to the calling rep. Without the rep-scope check, a rep
    // could enumerate other reps' submissions by guessing deal IDs.
    const isAdmin = ctx.user.role === 'master_admin' || ctx.user.role === 'company_admin';
    const conds = [eq(deals.id, params.id), eq(deals.companyId, ctx.companyId)];
    if (!isAdmin) conds.push(eq(deals.assignedRepId, ctx.user.id));
    const [deal] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(...conds))
      .limit(1);
    if (!deal) return NextResponse.json({ data: [] });

    // All submissions for this deal.
    const subs = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.dealId, params.id), eq(submissions.companyId, ctx.companyId)));
    if (subs.length === 0) return NextResponse.json({ data: [] });

    const subIds = subs.map((s) => s.id);
    const sfRows = await db
      .select({
        funderId: submissionFunders.funderId,
        funderName: funders.name,
        status: submissionFunders.status,
        submittedAt: submissionFunders.submittedAt,
      })
      .from(submissionFunders)
      .leftJoin(funders, eq(funders.id, submissionFunders.funderId))
      .where(inArray(submissionFunders.submissionId, subIds));

    // Dedupe: if the same funder was submitted to twice (shouldn't happen
    // because of server-side guards, but defensive), keep the most recent.
    const latest = new Map<string, { funderId: string; funderName: string; status: string; submittedAt: string }>();
    for (const r of sfRows) {
      if (!r.funderId || !r.funderName) continue;
      const existing = latest.get(r.funderId);
      if (!existing || new Date(r.submittedAt).getTime() > new Date(existing.submittedAt).getTime()) {
        latest.set(r.funderId, {
          funderId: r.funderId,
          funderName: r.funderName,
          status: r.status,
          submittedAt: r.submittedAt instanceof Date ? r.submittedAt.toISOString() : String(r.submittedAt),
        });
      }
    }

    return NextResponse.json({ data: Array.from(latest.values()) });
  } catch (e) {
    return apiError(e);
  }
}
