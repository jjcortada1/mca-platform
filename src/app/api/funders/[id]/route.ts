import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  funders, funderContacts, funderTierAssignments, funderRestrictedStates, funderRestrictedIndustries,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { upsertFunderSchema } from '@/lib/validation/schemas';
import { validateTierIds } from '@/lib/funders/repository';
import { apiError } from '@/lib/api/errors';
import { triggerSync } from '@/lib/sheets/sync';

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
      emails: body.emails && body.emails.length ? body.emails : null,
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

    if (body.tierAssignments && body.tierAssignments.length) {
      const validTierIds = await validateTierIds(ctx.companyId, body.tierAssignments.map((a) => a.tierId));
      const validSet = new Set(validTierIds);
      const rows = body.tierAssignments
        .filter((a) => validSet.has(a.tierId))
        .map((a) => ({
          funderId: params.id,
          tierId: a.tierId,
          maxPositions: a.maxPositions ?? null,
          minRevenue: a.minRevenue != null ? String(a.minRevenue) : null,
          minCreditTier: a.minCreditTier ?? null,
        }));
      if (rows.length) await db.insert(funderTierAssignments).values(rows);
    } else {
      const validTierIds = await validateTierIds(ctx.companyId, body.tierIds);
      if (validTierIds.length) {
        await db.insert(funderTierAssignments).values(
          validTierIds.map((tid) => ({ funderId: params.id, tierId: tid }))
        );
      }
    }
    if (body.restrictedStates.length) {
      await db.insert(funderRestrictedStates).values(body.restrictedStates.map((s) => ({ funderId: params.id, stateCode: s })));
    }
    if (body.restrictedIndustries.length) {
      await db.insert(funderRestrictedIndustries).values(body.restrictedIndustries.map((i) => ({ funderId: params.id, industry: i })));
    }
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('funders.edit');
    await db.delete(funders).where(and(eq(funders.id, params.id), eq(funders.companyId, ctx.companyId)));
    triggerSync(ctx.companyId);
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
