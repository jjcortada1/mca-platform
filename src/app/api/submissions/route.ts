import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { submissions, submissionFunders, deals, funders, users } from '@/lib/db/schema';
import { eq, desc, inArray, and } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { visibleRepIds } from '@/lib/auth/team-scope';
import { apiError } from '@/lib/api/errors';

export async function GET() {
  try {
    const ctx = await requirePermission('submissions.view');

    // Non-admin scoping: reps see only submissions for deals assigned to
    // them — plus, for team leaders, submissions for their team members'
    // deals. Admins see everything.
    const isAdmin = ctx.user.role === 'master_admin' || ctx.user.role === 'company_admin';
    const baseConditions = [
      eq(submissions.companyId, ctx.companyId),
      eq(deals.isDeleted, false),
    ];
    if (!isAdmin) {
      const scope = await visibleRepIds(ctx.user.id);
      baseConditions.push(
        scope.length === 1
          ? eq(deals.assignedRepId, scope[0])
          : inArray(deals.assignedRepId, scope)
      );
    }

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
        // Submission intake — structured "what to tell the funder"
        // context that lives on the deal. Returned here so submissions
        // can show it on the secondary-expand details panel.
        submissionIntake: deals.submissionIntake,
      })
      .from(submissions)
      .innerJoin(deals, eq(deals.id, submissions.dealId))
      .where(and(...baseConditions))
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
      // Both id and name — the client uses id for filtering and name for display.
      assignedRepId: s.assignedRepId,
      assignedRepName: s.assignedRepId ? repsMap.get(s.assignedRepId) : null,
      // Submission intake — surfaced for the secondary-expand details
      // panel on the submissions UI. May be null when the deal was
      // submitted without filling the intake form.
      submissionIntake: s.submissionIntake,
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

    triggerSync(ctx.companyId);
    return NextResponse.json({ submissions: result });
  } catch (e) { return apiError(e); }
}

import { z } from 'zod';
import { triggerSync } from '@/lib/sheets/sync';

const manualSubmissionSchema = z.object({
  // Use an existing deal OR create one from name
  dealId: z.string().uuid().optional(),
  dealName: z.string().min(1).max(200).optional(),
  // Use an existing funder OR a free-text funder name
  funderId: z.string().uuid().optional(),
  manualFunderName: z.string().min(1).max(200).optional(),
  status: z.enum(['no_response', 'approved', 'declined']).default('no_response'),
  notes: z.string().max(2000).optional(),
});

/**
 * POST /api/submissions
 * Manually create a submission record (no email sent, just logged).
 * Requires either dealId or dealName, and either funderId or manualFunderName.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requirePermission('deals.submit');
    const body = manualSubmissionSchema.parse(await req.json());

    if (!body.dealId && !body.dealName) {
      return NextResponse.json({ error: 'Either dealId or dealName is required' }, { status: 400 });
    }
    if (!body.funderId && !body.manualFunderName) {
      return NextResponse.json({ error: 'Either funderId or manualFunderName is required' }, { status: 400 });
    }

    // Resolve or create the deal
    let dealId = body.dealId;
    if (!dealId) {
      const [created] = await db.insert(deals).values({
        companyId: ctx.companyId,
        name: body.dealName!.trim(),
        status: 'submitted',
        createdBy: ctx.user.id,
      }).returning();
      dealId = created.id;
    } else {
      // Cross-tenant + soft-delete guard
      const [d] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
      if (!d || d.companyId !== ctx.companyId || d.isDeleted) {
        return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      }
    }

    // Guard funder ownership too if provided
    if (body.funderId) {
      const [f] = await db.select().from(funders).where(eq(funders.id, body.funderId)).limit(1);
      if (!f || f.companyId !== ctx.companyId) {
        return NextResponse.json({ error: 'Funder not found' }, { status: 404 });
      }
    }

    // Reuse existing submission for this deal if one exists, so the new funder
    // attaches to the same submission row instead of creating a duplicate.
    let submissionId: string;
    const [existing] = await db.select().from(submissions)
      .where(and(eq(submissions.dealId, dealId), eq(submissions.companyId, ctx.companyId)))
      .orderBy(submissions.createdAt)
      .limit(1);
    if (existing) {
      submissionId = existing.id;
    } else {
      const [sub] = await db.insert(submissions).values({
        companyId: ctx.companyId,
        dealId,
      }).returning();
      submissionId = sub.id;
    }

    // Attach the funder (no email sent — manual entry only)
    await db.insert(submissionFunders).values({
      submissionId,
      funderId: body.funderId ?? null,
      manualFunderName: body.funderId ? null : (body.manualFunderName ?? null),
      submittedBy: ctx.user.id,
      status: body.status,
      notes: body.notes ?? null,
    });

    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true, submissionId });
  } catch (e) { return apiError(e); }
}
