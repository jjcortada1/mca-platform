import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { syndicationDeals, syndicationEntries, syndicationReps } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdmin(role: string) { return role === 'company_admin' || role === 'master_admin'; }

async function getDeal(companyId: string, id: string) {
  const [row] = await db.select().from(syndicationDeals)
    .where(and(eq(syndicationDeals.id, id), eq(syndicationDeals.companyId, companyId), eq(syndicationDeals.isDeleted, false)))
    .limit(1);
  return row ?? null;
}

const patchSchema = z.object({
  dealName: z.string().min(1).max(300).optional(),
  fundingAmount: z.coerce.number().nonnegative().optional().nullable(),
  term: z.string().max(120).optional().nullable(),
  rate: z.string().max(60).optional().nullable(),
  commission: z.string().max(120).optional().nullable(),
  fee: z.string().max(120).optional().nullable(),
  hasEarlyPayoff: z.boolean().optional(),
  earlyPayoffDetails: z.string().max(2000).optional().nullable(),
  funderName: z.string().max(200).optional().nullable(),
  positionNumber: z.string().max(20).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  status: z.enum(['open', 'closed']).optional(),
});

/** PATCH — edit a syndication deal. Poster or admin only. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const deal = await getDeal(ctx.companyId, params.id);
    if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!isAdmin(ctx.user.role) && deal.createdBy !== ctx.user.id) {
      return NextResponse.json({ error: 'Only the poster or an admin can edit this.' }, { status: 403 });
    }
    const body = patchSchema.parse(await req.json());
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.dealName !== undefined) updates.dealName = body.dealName.trim();
    if (body.fundingAmount !== undefined) updates.fundingAmount = body.fundingAmount != null ? String(body.fundingAmount) : null;
    for (const k of ['term', 'rate', 'commission', 'fee', 'funderName', 'positionNumber', 'notes', 'earlyPayoffDetails'] as const) {
      if (body[k] !== undefined) updates[k] = body[k]?.trim() || null;
    }
    if (body.hasEarlyPayoff !== undefined) {
      updates.hasEarlyPayoff = body.hasEarlyPayoff;
      if (!body.hasEarlyPayoff) updates.earlyPayoffDetails = null;
    }
    if (body.status !== undefined) updates.status = body.status;
    await db.update(syndicationDeals).set(updates).where(eq(syndicationDeals.id, deal.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/** DELETE — soft-delete a syndication deal. Poster or admin only. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const deal = await getDeal(ctx.companyId, params.id);
    if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!isAdmin(ctx.user.role) && deal.createdBy !== ctx.user.id) {
      return NextResponse.json({ error: 'Only the poster or an admin can remove this.' }, { status: 403 });
    }
    await db.update(syndicationDeals).set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(syndicationDeals.id, deal.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

const entrySchema = z.object({
  repName: z.string().min(1).max(200),
  companyName: z.string().max(200).optional().nullable(),
  amount: z.coerce.number().positive(),
});

/**
 * POST /api/syndication/[id] — add YOUR syndication entry to a deal
 * (rep name, company, amount). Any non-lead-source user can participate.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    if (ctx.user.role === 'lead_source') {
      return NextResponse.json({ error: 'Not available for this account' }, { status: 403 });
    }
    const deal = await getDeal(ctx.companyId, params.id);
    if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (deal.status === 'closed') {
      return NextResponse.json({ error: 'This syndication is closed.' }, { status: 400 });
    }
    const body = entrySchema.parse(await req.json());
    const repName = body.repName.trim();
    const companyName = body.companyName?.trim() || null;
    const [row] = await db.insert(syndicationEntries).values({
      syndicationDealId: deal.id,
      userId: ctx.user.id,
      repName,
      companyName,
      amount: String(body.amount),
    }).returning();

    // Keep the rep ↔ company directory fresh: a new name is saved
    // automatically so next time it's a one-click pick. Best-effort.
    try {
      const existing = await db.select().from(syndicationReps)
        .where(eq(syndicationReps.companyId, ctx.companyId));
      const match = existing.find((r) => r.repName.toLowerCase() === repName.toLowerCase());
      if (!match) {
        await db.insert(syndicationReps).values({
          companyId: ctx.companyId, repName, repCompanyName: companyName,
        });
      } else if (companyName && companyName !== match.repCompanyName) {
        await db.update(syndicationReps).set({ repCompanyName: companyName })
          .where(eq(syndicationReps.id, match.id));
      }
    } catch { /* directory upkeep never blocks the entry */ }

    return NextResponse.json({ ok: true, data: row });
  } catch (e) { return apiError(e); }
}
