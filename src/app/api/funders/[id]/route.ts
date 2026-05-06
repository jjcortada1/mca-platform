import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  funders, funderContacts, funderTierAssignments, funderRestrictedStates, funderRestrictedIndustries,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { upsertFunderSchema } from '@/lib/validation/schemas';
import { validateTierIds } from '@/lib/funders/repository';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('funders.edit');
    const body = upsertFunderSchema.parse(await req.json());

    const [existing] = await db.select().from(funders)
      .where(and(eq(funders.id, params.id), eq(funders.companyId, ctx.companyId))).limit(1);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.update(funders).set({
      name: body.name,
      submissionMethod: body.submissionMethod,
      supportsReverseConsolidation: body.supportsReverseConsolidation,
      minRevenue: String(body.minRevenue),
      maxPositions: body.maxPositions,
      minCreditTier: body.minCreditTier,
      notes: body.notes ?? null,
      isActive: body.isActive,
      updatedAt: new Date(),
    }).where(and(eq(funders.id, params.id), eq(funders.companyId, ctx.companyId)));

    // Replace child rows
    await db.delete(funderContacts).where(eq(funderContacts.funderId, params.id));
    await db.delete(funderTierAssignments).where(eq(funderTierAssignments.funderId, params.id));
    await db.delete(funderRestrictedStates).where(eq(funderRestrictedStates.funderId, params.id));
    await db.delete(funderRestrictedIndustries).where(eq(funderRestrictedIndustries.funderId, params.id));

    if (body.contacts.length) {
      await db.insert(funderContacts).values(body.contacts.map((c) => ({
        funderId: params.id, name: c.name, phone: c.phone || null, email: c.email || null, isPrimary: c.isPrimary,
      })));
    }
    const validTierIds = await validateTierIds(ctx.companyId, body.tierIds);
    if (validTierIds.length) {
      await db.insert(funderTierAssignments).values(
        validTierIds.map((tid) => ({ funderId: params.id, tierId: tid }))
      );
    }
    if (body.restrictedStates.length) {
      await db.insert(funderRestrictedStates).values(body.restrictedStates.map((s) => ({ funderId: params.id, stateCode: s })));
    }
    if (body.restrictedIndustries.length) {
      await db.insert(funderRestrictedIndustries).values(body.restrictedIndustries.map((i) => ({ funderId: params.id, industry: i })));
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('funders.edit');
    await db.delete(funders).where(and(eq(funders.id, params.id), eq(funders.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
