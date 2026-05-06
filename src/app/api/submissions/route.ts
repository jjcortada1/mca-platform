import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { submissions, submissionFunders, deals, funders, users } from '@/lib/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';

export async function GET() {
  try {
    const ctx = await requirePermission('submissions.view');

    // 1. All submissions for this company, joined to deal info
    const subs = await db
      .select({
        sId: submissions.id,
        sCreatedAt: submissions.createdAt,
        sUpdatedAt: submissions.updatedAt,
        dealId: deals.id,
        dealName: deals.name,
        dealStatus: deals.status,
        merchantFirstName: deals.merchantFirstName,
        merchantLastName: deals.merchantLastName,
        assignedRepId: deals.assignedRepId,
      })
      .from(submissions)
      .innerJoin(deals, eq(deals.id, submissions.dealId))
      .where(eq(submissions.companyId, ctx.companyId))
      .orderBy(desc(submissions.updatedAt));

    if (!subs.length) return NextResponse.json({ submissions: [] });

    // 2. All submission_funders for these submissions, with funder info
    const submissionIds = subs.map((s) => s.sId);
    const sfRows = await db
      .select({
        id: submissionFunders.id,
        submissionId: submissionFunders.submissionId,
        funderId: submissionFunders.funderId,
        manualFunderName: submissionFunders.manualFunderName,
        status: submissionFunders.status,
        notes: submissionFunders.notes,
        submittedAt: submissionFunders.submittedAt,
        submittedBy: submissionFunders.submittedBy,
        funderName: funders.name,
      })
      .from(submissionFunders)
      .leftJoin(funders, eq(funders.id, submissionFunders.funderId))
      .where(inArray(submissionFunders.submissionId, submissionIds));

    // Group submission_funders by submissionId
    const sfBySubmission = new Map<string, typeof sfRows>();
    for (const sf of sfRows) {
      const arr = sfBySubmission.get(sf.submissionId) ?? [];
      arr.push(sf);
      sfBySubmission.set(sf.submissionId, arr);
    }

    // Hydrate rep names
    const repIds = Array.from(new Set(subs.map((s) => s.assignedRepId).filter(Boolean) as string[]));
    const repsMap = new Map<string, string>();
    if (repIds.length) {
      const repRows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, repIds));
      for (const r of repRows) repsMap.set(r.id, r.name);
    }

    const result = subs.map((s) => ({
      submissionId: s.sId,
      dealId: s.dealId,
      dealName: s.dealName,
      dealStatus: s.dealStatus,
      merchantName: [s.merchantFirstName, s.merchantLastName].filter(Boolean).join(' '),
      assignedRepName: s.assignedRepId ? repsMap.get(s.assignedRepId) : null,
      updatedAt: s.sUpdatedAt,
      createdAt: s.sCreatedAt,
      funders: (sfBySubmission.get(s.sId) ?? []).map((sf) => ({
        id: sf.id,
        funderName: sf.funderName ?? sf.manualFunderName,
        status: sf.status,
        notes: sf.notes,
        submittedAt: sf.submittedAt,
      })),
    }));

    return NextResponse.json({ submissions: result });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
