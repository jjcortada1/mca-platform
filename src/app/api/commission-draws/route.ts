import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { commissionDraws, users } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';
import { fromDateInput } from '@/lib/dates';

export const runtime = 'nodejs';

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
}

/** GET /api/commission-draws?repId=... — admin all/filter, rep own. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const admin = isAdmin(ctx.user);
    const url = new URL(req.url);
    const repFilter = url.searchParams.get('repId');

    const conds = [eq(commissionDraws.companyId, ctx.companyId)];
    if (!admin) conds.push(eq(commissionDraws.repId, ctx.user.id));
    else if (repFilter) conds.push(eq(commissionDraws.repId, repFilter));

    const rows = await db.select({ d: commissionDraws, repName: users.name })
      .from(commissionDraws)
      .leftJoin(users, eq(users.id, commissionDraws.repId))
      .where(and(...conds))
      .orderBy(desc(commissionDraws.drawDate));

    return NextResponse.json({ draws: rows.map((r) => ({ ...r.d, repName: r.repName })) });
  } catch (e) { return apiError(e); }
}

const schema = z.object({
  repId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  drawDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/** POST /api/commission-draws — admin issues a draw/advance to a rep. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = schema.parse(await req.json());

    const [rep] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, body.repId), eq(users.companyId, ctx.companyId))).limit(1);
    if (!rep) return NextResponse.json({ error: 'Rep not in this company' }, { status: 400 });

    const [row] = await db.insert(commissionDraws).values({
      companyId: ctx.companyId,
      repId: body.repId,
      amount: String(body.amount),
      drawDate: body.drawDate ? fromDateInput(body.drawDate) ?? new Date() : new Date(),
      notes: body.notes ?? null,
      createdBy: ctx.user.id,
    }).returning();

    return NextResponse.json({ ok: true, draw: row });
  } catch (e) { return apiError(e); }
}
