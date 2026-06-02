import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { accountingEntries, deals, users } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
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

/** GET /api/accounting — admin only. Lists every entry with deal + creator joined. */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const creator = alias(users, 'creator');
    const rows = await db.select({
      e: accountingEntries,
      dealName: deals.name,
      dealDeleted: deals.isDeleted,
      createdByName: creator.name,
    })
      .from(accountingEntries)
      .leftJoin(deals, eq(deals.id, accountingEntries.dealId))
      .leftJoin(creator, eq(creator.id, accountingEntries.createdBy))
      .where(and(eq(accountingEntries.companyId, ctx.companyId), eq(accountingEntries.isDeleted, false)))
      .orderBy(desc(accountingEntries.entryDate));

    // Drop entries whose linked deal is soft-deleted. Standalone entries
    // (no dealId) still show.
    const visible = rows.filter((r) => !r.e.dealId || r.dealDeleted === false);

    triggerSync(ctx.companyId);
    return NextResponse.json({
      entries: visible.map((r) => ({ ...r.e, dealName: r.dealName, createdByName: r.createdByName })),
    });
  } catch (e) { return apiError(e); }
}

const schema = z.object({
  dealId: z.string().uuid().nullable().optional(),
  entryType: z.enum(['received', 'sent_back']),
  amount: z.coerce.number().positive(),
  entryDate: z.string().optional().nullable(),
  method: z.enum(['ach', 'wire', 'check', 'cash', 'zelle', 'other']).optional().nullable(),
  referenceNumber: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/** POST /api/accounting — admin logs money in or out. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!isAdmin(ctx.user)) return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    const body = schema.parse(await req.json());

    if (body.dealId) {
      const [d] = await db.select({ id: deals.id }).from(deals)
        .where(and(eq(deals.id, body.dealId), eq(deals.companyId, ctx.companyId))).limit(1);
      if (!d) return NextResponse.json({ error: 'Deal not in this company' }, { status: 400 });
    }

    const [row] = await db.insert(accountingEntries).values({
      companyId: ctx.companyId,
      dealId: body.dealId ?? null,
      entryType: body.entryType,
      amount: String(body.amount),
      entryDate: body.entryDate ? fromDateInput(body.entryDate) ?? new Date() : new Date(),
      method: body.method ?? null,
      referenceNumber: body.referenceNumber ?? null,
      notes: body.notes ?? null,
      createdBy: ctx.user.id,
    }).returning();

    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true, entry: row });
  } catch (e) { return apiError(e); }
}
