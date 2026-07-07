import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { fundedApprovals, users, deals } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { requireTenantContext, requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { notifyUsers, companyAdminIds } from '@/lib/notify';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/funded-approvals
 * Admins: the full queue (pending first). Reps: only their own submissions,
 * so they can see whether an approval is still pending / was approved.
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';
    const where = isAdmin
      ? eq(fundedApprovals.companyId, ctx.companyId)
      : and(eq(fundedApprovals.companyId, ctx.companyId), eq(fundedApprovals.submittedBy, ctx.user.id));
    const rows = await db
      .select({
        a: fundedApprovals,
        repName: users.name,
      })
      .from(fundedApprovals)
      .leftJoin(users, eq(users.id, fundedApprovals.repId))
      .where(where)
      .orderBy(desc(fundedApprovals.createdAt))
      .limit(50);
    const data = rows.map(({ a, repName }) => ({ ...a, repName }));
    return NextResponse.json({ data, pendingCount: data.filter((r) => r.status === 'pending').length });
  } catch (e) { return apiError(e); }
}

const createSchema = z.object({
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
  payload: z.any().optional().nullable(),
});

/**
 * POST — create a pending funded approval. Called automatically after a
 * funded email is sent. Admins get a notification; nothing is applied to the
 * deal/commissions until an admin approves.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('deals.submit');
    const body = createSchema.parse(await req.json());

    // Tenant guards on the optional references.
    if (body.dealId) {
      const [d] = await db.select({ id: deals.id }).from(deals)
        .where(and(eq(deals.id, body.dealId), eq(deals.companyId, ctx.companyId), eq(deals.isDeleted, false))).limit(1);
      if (!d) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }
    if (body.repId) {
      const [r] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, body.repId), eq(users.companyId, ctx.companyId))).limit(1);
      if (!r) return NextResponse.json({ error: 'Rep not in this company' }, { status: 400 });
    }

    const [row] = await db.insert(fundedApprovals).values({
      companyId: ctx.companyId,
      dealId: body.dealId ?? null,
      dealName: body.dealName?.trim() || null,
      repId: body.repId ?? null,
      fundedAmount: body.fundedAmount != null ? String(body.fundedAmount) : null,
      factorRate: body.factorRate != null ? String(body.factorRate) : null,
      termDetails: body.termDetails?.trim() || null,
      funderName: body.funderName?.trim() || null,
      grossCommission: body.grossCommission != null ? String(body.grossCommission) : null,
      repSplitPct: body.repSplitPct != null ? String(body.repSplitPct) : null,
      notes: body.notes?.trim() || null,
      payload: body.payload ?? null,
      submittedBy: ctx.user.id,
    }).returning();

    // Ping every admin: something is waiting for review.
    const admins = await companyAdminIds(ctx.companyId);
    notifyUsers(ctx.companyId, admins, {
      title: 'Funded deal awaiting approval',
      body: `${ctx.user.name || ctx.user.email} sent a funded email${row.dealName ? ` for "${row.dealName}"` : ''}. Review and approve to log it.`,
      link: '/portfolio?approvals=1',
    }, ctx.user.id).catch(() => {});

    return NextResponse.json({ ok: true, data: row });
  } catch (e) { return apiError(e); }
}
