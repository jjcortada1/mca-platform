import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { commissionPayments, users, dealCommissions, leadSourceCommissions, leadSources, deals } from '@/lib/db/schema';
import { and, eq, desc, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';
import { fromDateInput } from '@/lib/dates';
import { triggerSync } from '@/lib/sheets/sync';

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
    const dealCommissionId = url.searchParams.get('dealCommissionId');
    const leadSourceCommissionId = url.searchParams.get('leadSourceCommissionId');

    const conds = [eq(commissionPayments.companyId, ctx.companyId), eq(commissionPayments.isDeleted, false)];
    if (!admin) conds.push(eq(commissionPayments.repId, ctx.user.id));
    else if (repFilter) conds.push(eq(commissionPayments.repId, repFilter));
    if (dealCommissionId) conds.push(eq(commissionPayments.dealCommissionId, dealCommissionId));
    if (leadSourceCommissionId) conds.push(eq(commissionPayments.leadSourceCommissionId, leadSourceCommissionId));

    // Two separate aliases for users — one for the payee (rep), one for the
    // admin who created the payment.
    const rep = alias(users, 'rep');
    const creator = alias(users, 'creator');

    const rows = await db.select({
      p: commissionPayments,
      repName: rep.name,
      leadSourceName: leadSources.name,
      dealName: deals.name,
      createdByName: creator.name,
    })
      .from(commissionPayments)
      .leftJoin(rep, eq(rep.id, commissionPayments.repId))
      .leftJoin(leadSources, eq(leadSources.id, commissionPayments.leadSourceId))
      .leftJoin(dealCommissions, eq(dealCommissions.id, commissionPayments.dealCommissionId))
      .leftJoin(leadSourceCommissions, eq(leadSourceCommissions.id, commissionPayments.leadSourceCommissionId))
      .leftJoin(deals, eq(deals.id, sql`coalesce(${dealCommissions.dealId}, ${leadSourceCommissions.dealId})`))
      .leftJoin(creator, eq(creator.id, commissionPayments.createdBy))
      .where(and(...conds))
      .orderBy(desc(commissionPayments.paidDate));

    return NextResponse.json({
      payments: rows.map((r) => ({
        ...r.p,
        repName: r.repName,
        leadSourceName: r.leadSourceName,
        dealName: r.dealName,
        createdByName: r.createdByName,
        // Derived payee fields for the admin UI.
        payeeName: r.leadSourceName ?? r.repName ?? '(unassigned)',
        payeeType: r.leadSourceName ? 'lead_source' : (r.repName ? 'rep' : 'unknown'),
      })),
    });
  } catch (e) { return apiError(e); }
}

const schema = z.object({
  repId: z.string().uuid().nullable().optional(),
  dealCommissionId: z.string().uuid().nullable().optional(),
  leadSourceCommissionId: z.string().uuid().nullable().optional(),
  // Direct payee — used when the payment isn't tied to a specific commission
  // record (e.g. a general payout to a lead source).
  leadSourceId: z.string().uuid().nullable().optional(),
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

    // If linked to a lead source commission, pull its lead source id so the
    // portal's payment history can scope to it.
    let leadSourceId: string | null = null;
    if (body.leadSourceCommissionId) {
      const [lsc] = await db.select().from(leadSourceCommissions)
        .where(and(eq(leadSourceCommissions.id, body.leadSourceCommissionId), eq(leadSourceCommissions.companyId, ctx.companyId))).limit(1);
      if (!lsc) return NextResponse.json({ error: 'Lead source commission not found' }, { status: 404 });
      leadSourceId = lsc.leadSourceId;
    } else if (body.leadSourceId) {
      // General payout to a lead source not tied to a specific commission.
      const [ls] = await db.select().from(leadSources)
        .where(and(eq(leadSources.id, body.leadSourceId), eq(leadSources.companyId, ctx.companyId))).limit(1);
      if (!ls) return NextResponse.json({ error: 'Lead source not found' }, { status: 404 });
      leadSourceId = ls.id;
    }

    const [row] = await db.insert(commissionPayments).values({
      companyId: ctx.companyId,
      repId: body.repId ?? null,
      dealCommissionId: body.dealCommissionId ?? null,
      leadSourceCommissionId: body.leadSourceCommissionId ?? null,
      leadSourceId,
      amount: String(body.amount),
      paidDate: body.paidDate ? fromDateInput(body.paidDate) ?? new Date() : new Date(),
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

    // Same for lead source commission.
    if (body.leadSourceCommissionId) {
      const [lsc] = await db.select().from(leadSourceCommissions)
        .where(and(eq(leadSourceCommissions.id, body.leadSourceCommissionId), eq(leadSourceCommissions.companyId, ctx.companyId))).limit(1);
      if (lsc) {
        await db.update(leadSourceCommissions)
          .set({ paidAmount: String(Number(lsc.paidAmount) + body.amount), updatedAt: new Date(), syncState: 'pending' })
          .where(eq(leadSourceCommissions.id, lsc.id));
      }
    }

    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true, payment: row });
  } catch (e) { return apiError(e); }
}
