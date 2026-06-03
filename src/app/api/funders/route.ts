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
import { apiError } from '@/lib/api/errors';
import { triggerSync } from '@/lib/sheets/sync';

// Force dynamic: funder edits must reflect immediately on submit/deal-shop pages.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
        .map((a) => {
          const t = tierMap.get(a.tierId);
          if (!t) return null;
          return {
            id: t.id,
            name: t.name,
            // Per-tier overrides; null means inherit from base funder values.
            maxPositions: a.maxPositions,
            minRevenue: a.minRevenue,
            minCreditTier: a.minCreditTier,
          };
        })
        .filter(Boolean) as { id: string; name: string; maxPositions: number | null; minRevenue: string | null; minCreditTier: string | null }[],
      restrictedStates: states.filter((s) => s.funderId === f.id).map((s) => s.stateCode),
      restrictedIndustries: inds.filter((i) => i.funderId === f.id).map((i) => i.industry),
    }));
    triggerSync(ctx.companyId);
    return NextResponse.json({ data: enriched, funders: enriched });
  } catch (e) {
    return apiError(e);
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
      emails: body.emails && body.emails.length ? body.emails : null,
      notes: body.notes ?? null,
      isActive: body.isActive,
      plainSubjectOnly: body.plainSubjectOnly ?? false,
    }).returning();

    if (body.contacts.length) {
      await db.insert(funderContacts).values(body.contacts.map((c) => ({
        funderId: f.id, name: c.name, phone: c.phone || null, email: c.email || null, isPrimary: c.isPrimary,
      })));
    }

    // Tier assignments: prefer the richer tierAssignments shape (with
    // per-tier overrides). Fall back to legacy tierIds (no overrides).
    if (body.tierAssignments && body.tierAssignments.length) {
      const validTierIds = await validateTierIds(ctx.companyId, body.tierAssignments.map((a) => a.tierId));
      const validSet = new Set(validTierIds);
      const rows = body.tierAssignments
        .filter((a) => validSet.has(a.tierId))
        .map((a) => ({
          funderId: f.id,
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
          validTierIds.map((tid) => ({ funderId: f.id, tierId: tid }))
        );
      }
    }
    if (body.restrictedStates.length) {
      await db.insert(funderRestrictedStates).values(body.restrictedStates.map((s) => ({ funderId: f.id, stateCode: s })));
    }
    if (body.restrictedIndustries.length) {
      await db.insert(funderRestrictedIndustries).values(body.restrictedIndustries.map((i) => ({ funderId: f.id, industry: i })));
    }
    triggerSync(ctx.companyId);
    return NextResponse.json({ funder: f, data: f });
  } catch (e) {
    return apiError(e);
  }
}
