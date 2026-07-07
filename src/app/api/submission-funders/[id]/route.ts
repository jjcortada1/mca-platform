import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { submissionFunders, submissions, deals, funders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { updateSubmissionFunderSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';
import { notifyUsers, leadersOf } from '@/lib/notify';

async function verifyOwnership(submissionFunderId: string, companyId: string) {
  const [row] = await db.select({ sId: submissions.id, cId: submissions.companyId })
    .from(submissionFunders)
    .innerJoin(submissions, eq(submissions.id, submissionFunders.submissionId))
    .where(eq(submissionFunders.id, submissionFunderId)).limit(1);
  return row?.cId === companyId;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('submissions.edit');
    if (!(await verifyOwnership(params.id, ctx.companyId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = updateSubmissionFunderSchema.parse(await req.json());
    // Snapshot BEFORE the update so we only notify on a real status change.
    const [before] = await db.select().from(submissionFunders)
      .where(eq(submissionFunders.id, params.id)).limit(1);
    await db.update(submissionFunders).set(body).where(eq(submissionFunders.id, params.id));

    // Funder response status changed → ping the deal's rep + team leader(s).
    if (before && body.status && body.status !== before.status) {
      try {
        const [row] = await db
          .select({ dealName: deals.name, dealId: deals.id, assignedRepId: deals.assignedRepId, funderName: funders.name, manualName: submissionFunders.manualFunderName })
          .from(submissionFunders)
          .innerJoin(submissions, eq(submissions.id, submissionFunders.submissionId))
          .innerJoin(deals, eq(deals.id, submissions.dealId))
          .leftJoin(funders, eq(funders.id, submissionFunders.funderId))
          .where(eq(submissionFunders.id, params.id)).limit(1);
        if (row?.assignedRepId) {
          const fName = row.funderName || row.manualName || 'a funder';
          notifyUsers(
            ctx.companyId,
            [row.assignedRepId, ...(await leadersOf(row.assignedRepId))],
            {
              title: `Submission update: ${row.dealName}`,
              body: `${fName} → ${String(body.status).replace(/_/g, ' ')}.`,
              link: '/submissions',
            },
            ctx.user.id,
          ).catch(() => {});
        }
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('submissions.edit');
    if (!(await verifyOwnership(params.id, ctx.companyId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await db.delete(submissionFunders).where(eq(submissionFunders.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
