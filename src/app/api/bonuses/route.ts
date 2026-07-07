import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { funderBonuses } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { fromDateInput } from '@/lib/dates';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/bonuses — every funder bonus for the company. Visible to the whole
 * team (that's the point: reps route deals toward funders paying bonuses).
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') {
      return NextResponse.json({ error: 'Not available for this account' }, { status: 403 });
    }
    const rows = await db.select().from(funderBonuses)
      .where(and(eq(funderBonuses.companyId, ctx.companyId), eq(funderBonuses.isDeleted, false)))
      .orderBy(desc(funderBonuses.createdAt));
    return NextResponse.json({ data: rows });
  } catch (e) { return apiError(e); }
}

const upsertSchema = z.object({
  funderName: z.string().min(1).max(200),
  funderId: z.string().uuid().optional().nullable(),
  bonus: z.string().min(1).max(4000),
  conditions: z.string().max(4000).optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  isRunning: z.boolean().optional(),
});

function isAdmin(role: string) { return role === 'company_admin' || role === 'master_admin'; }

/** POST — add a bonus. Admin only (bonuses are company-published info). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user.role)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = upsertSchema.parse(await req.json());
    const running = body.isRunning ?? false;
    const [row] = await db.insert(funderBonuses).values({
      companyId: ctx.companyId,
      funderId: body.funderId ?? null,
      funderName: body.funderName.trim(),
      bonus: body.bonus.trim(),
      conditions: body.conditions?.trim() || null,
      startDate: !running && body.startDate ? fromDateInput(body.startDate) : null,
      endDate: !running && body.endDate ? fromDateInput(body.endDate) : null,
      isRunning: running,
      createdBy: ctx.user.id,
    }).returning();
    return NextResponse.json({ ok: true, data: row });
  } catch (e) { return apiError(e); }
}
