import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { commissionPayments, users, dealCommissions } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';

export const runtime = 'nodejs';

function isAdmin(u: SessionUser) {
  return u.role === 'company_admin' || u.role === 'master_admin' || hasPermission(u, 'commissions.manage');
}

/**
 * GET /api/commission-payments?repId=...
 * Admin: all (optionally filtered by rep). Rep: only their own.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const admin = isAdmin(ctx.user);
    const url = new URL(req.url);
    const repFilter = url.searchParams.get('repId');

    const conds = [eq(commissionPayments.companyId, ctx.companyId)];
    if (!admin) conds.push(eq(commissionPayments.repId, ctx.user.id));
    else if (repFilter) conds.push(eq(commissionPayments.repId, repFilter));

    const rows = await db.select({
      p: commissionPayments,
      repName: users.name,
    })
      .from(commissionPayments)
      .leftJoin(users, eq(users.id, commissionPayments.repId))
      .where(and(...conds))
      .orderBy(desc(commissionPayments.paidDate));

    return NextResponse.json({
      payments: rows.map((r) => ({ ...r.p, repName: r.repName })),
    });
  } catch (e) { return apiError(e); }
}

const schema = z.object({
  repId: z.string().uuid().nullable().optional(),
  dealCommissionId: z.string().uuid().nullable().optional(),
  amount: z.coerce.number().positive(),
  paidDate: z.string().optional().nullable(),
  method: z.enum(['ach', 'wire', 'check', 'cash', 'zelle', 'other']).optional().nullable(),
  confirmationNumber: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/** POST /api/commission-payments — admin logs a payout. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = schema.parse(await req.json());

    if (body.repId) {
      const [rep] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, body.repId), eq(users.companyId, ctx.companyId))).limit(1);
      if (!rep) return NextResponse.json({ error: 'Rep not in this company' }, { status: 400 });
    }

    const [row] = await db.insert(commissionPayments).values({
      companyId: ctx.companyId,
      repId: body.repId ?? null,
      dealCommissionId: body.dealCommissionId ?? null,
      amount: String(body.amount),
      paidDate: body.paidDate ? new Date(body.paidDate) : new Date(),
      method: body.method ?? null,
      confirmationNumber: body.confirmationNumber ?? null,
      notes: body.notes ?? null,
      createdBy: ctx.user.id,
    }).returning();

    // If linked to a specific deal commission, also bump its paidAmount.
    if (body.dealCommissionId) {
      const [dc] = await db.select().from(dealCommissions)
        .where(and(eq(dealCommissions.id, body.dealCommissionId), eq(dealCommissions.companyId, ctx.companyId))).limit(1);
      if (dc) {
        await db.update(dealCommissions)
          .set({ paidAmount: String(Number(dc.paidAmount) + body.amount), updatedAt: new Date() })
          .where(eq(dealCommissions.id, dc.id));
      }
    }

    return NextResponse.json({ ok: true, payment: row });
  } catch (e) { return apiError(e); }
}
