import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  funders, funderContacts, funderTierAssignments, funderRestrictedStates,
  funderRestrictedIndustries, funderTiers,
} from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { requirePermission, requireTenantContext } from '@/lib/auth/context';
import { upsertFunderSchema } from '@/lib/validation/schemas';
import { validateTierIds } from '@/lib/funders/repository';

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const list = await db.select().from(funders).where(eq(funders.companyId, ctx.companyId));
    if (!list.length) return NextResponse.json({ data: [], funders: [] });
    const ids = list.map((f) => f.id);
    const [contacts, assignments, states, inds, tiers] = await Promise.all([
      db.select().from(funderContacts).where(inArray(funderContacts.funderId, ids)),
      db.select().from(funderTierAssignments).where(inArray(funderTierAssignments.funderId, ids)),
      db.select().from(funderRestrictedStates).where(inArray(funderRestrictedStates.funderId, ids)),
      db.select().from(funderRestrictedIndustries).where(inArray(funderRestrictedIndustries.funderId, ids)),
      db.select().from(funderTiers).where(eq(funderTiers.companyId, ctx.companyId)),
    ]);
    const tierMap = new Map(tiers.map((t) => [t.id, t]));
    const enriched = list.map((f) => ({
      ...f,
      contacts: contacts.filter((c) => c.funderId === f.id),
      tiers: assignments
        .filter((a) => a.funderId === f.id)
        .map((a) => tierMap.get(a.tierId))
        .filter(Boolean)
        .map((t) => ({ id: t!.id, name: t!.name })),
      restrictedStates: states.filter((s) => s.funderId === f.id).map((s) => s.stateCode),
      restrictedIndustries: inds.filter((i) => i.funderId === f.id).map((i) => i.industry),
    }));
    return NextResponse.json({ data: enriched, funders: enriched });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('funders.edit');
    const body = upsertFunderSchema.parse(await req.json());

    const [f] = await db.insert(funders).values({
      companyId: ctx.companyId,
      name: body.name,
      submissionMethod: body.submissionMethod,
      supportsReverseConsolidation: body.supportsReverseConsolidation,
      minRevenue: String(body.minRevenue),
      maxPositions: body.maxPositions,
      minCreditTier: body.minCreditTier,
      notes: body.notes ?? null,
      isActive: body.isActive,
    }).returning();

    if (body.contacts.length) {
      await db.insert(funderContacts).values(body.contacts.map((c) => ({
        funderId: f.id, name: c.name, phone: c.phone || null, email: c.email || null, isPrimary: c.isPrimary,
      })));
    }
    const validTierIds = await validateTierIds(ctx.companyId, body.tierIds);
    if (validTierIds.length) {
      await db.insert(funderTierAssignments).values(
        validTierIds.map((tid) => ({ funderId: f.id, tierId: tid }))
      );
    }
    if (body.restrictedStates.length) {
      await db.insert(funderRestrictedStates).values(body.restrictedStates.map((s) => ({ funderId: f.id, stateCode: s })));
    }
    if (body.restrictedIndustries.length) {
      await db.insert(funderRestrictedIndustries).values(body.restrictedIndustries.map((i) => ({ funderId: f.id, industry: i })));
    }
    return NextResponse.json({ funder: f, data: f });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
