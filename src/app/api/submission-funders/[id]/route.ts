import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { submissionFunders, submissions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { updateSubmissionFunderSchema } from '@/lib/validation/schemas';

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
    await db.update(submissionFunders).set(body).where(eq(submissionFunders.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('submissions.edit');
    if (!(await verifyOwnership(params.id, ctx.companyId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await db.delete(submissionFunders).where(eq(submissionFunders.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
