import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { syndicationDeals, syndicationEntries, users } from '@/lib/db/schema';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/syndication — every syndication deal for the company, each with
 * its rep entries and a committed total. The whole company can see the board
 * (that's the point — reps put their name down); lead sources cannot.
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') {
      return NextResponse.json({ error: 'Not available for this account' }, { status: 403 });
    }
    const rows = await db.select().from(syndicationDeals)
      .where(and(eq(syndicationDeals.companyId, ctx.companyId), eq(syndicationDeals.isDeleted, false)))
      .orderBy(desc(syndicationDeals.createdAt));

    const ids = rows.map((r) => r.id);
    const entries = ids.length
      ? await db.select().from(syndicationEntries).where(inArray(syndicationEntries.syndicationDealId, ids))
      : [];
    const byDeal = new Map<string, typeof entries>();
    for (const e of entries) {
      const list = byDeal.get(e.syndicationDealId) ?? [];
      list.push(e);
      byDeal.set(e.syndicationDealId, list);
    }
    const data = rows.map((r) => {
      const es = (byDeal.get(r.id) ?? []).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      const committed = es.reduce((s, e) => s + Number(e.amount || 0), 0);
      // Resolved dollar cap: flat amount wins; else percent of funding.
      const cap = r.availableAmount != null
        ? Number(r.availableAmount)
        : (r.availablePct != null && r.fundingAmount != null
            ? (Number(r.fundingAmount) * Number(r.availablePct)) / 100
            : null);
      return { ...r, entries: es, committedTotal: committed, availableCap: cap };
    });
    return NextResponse.json({ data });
  } catch (e) { return apiError(e); }
}

const createSchema = z.object({
  dealId: z.string().uuid().optional().nullable(),
  dealName: z.string().min(1).max(300),
  fundingAmount: z.coerce.number().nonnegative().optional().nullable(),
  // How much is open for syndication — a flat dollar amount OR a percent of
  // the funding amount. If both are sent, the dollar amount wins.
  availableAmount: z.coerce.number().nonnegative().optional().nullable(),
  availablePct: z.coerce.number().min(0).max(100).optional().nullable(),
  term: z.string().max(120).optional().nullable(),
  rate: z.string().max(60).optional().nullable(),
  commission: z.string().max(120).optional().nullable(),
  fee: z.string().max(120).optional().nullable(),
  hasEarlyPayoff: z.boolean().optional(),
  earlyPayoffDetails: z.string().max(2000).optional().nullable(),
  funderName: z.string().max(200).optional().nullable(),
  positionNumber: z.string().max(20).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

/**
 * POST /api/syndication — post a deal onto the syndication board.
 * Anyone who can shop/edit deals can post one.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    if (!(hasPermission(ctx.user, 'deals.shop') || hasPermission(ctx.user, 'deals.edit'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = createSchema.parse(await req.json());
    const [row] = await db.insert(syndicationDeals).values({
      companyId: ctx.companyId,
      dealId: body.dealId ?? null,
      dealName: body.dealName.trim(),
      fundingAmount: body.fundingAmount != null ? String(body.fundingAmount) : null,
      availableAmount: body.availableAmount != null ? String(body.availableAmount) : null,
      availablePct: body.availableAmount == null && body.availablePct != null ? String(body.availablePct) : null,
      term: body.term?.trim() || null,
      rate: body.rate?.trim() || null,
      commission: body.commission?.trim() || null,
      fee: body.fee?.trim() || null,
      hasEarlyPayoff: body.hasEarlyPayoff ?? false,
      earlyPayoffDetails: body.hasEarlyPayoff ? (body.earlyPayoffDetails?.trim() || null) : null,
      funderName: body.funderName?.trim() || null,
      positionNumber: body.positionNumber?.trim() || null,
      notes: body.notes?.trim() || null,
      createdBy: ctx.user.id,
    }).returning();
    return NextResponse.json({ ok: true, data: row });
  } catch (e) { return apiError(e); }
}
