import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  funders, funderRestrictedStates, funderRestrictedIndustries,
  funderTierAssignments, funderTiers,
} from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { dealShopMatchSchema } from '@/lib/validation/schemas';
import { matchAll, type FunderForMatching, type CreditTier } from '@/lib/matching/engine';
import { apiError } from '@/lib/api/errors';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('deals.shop');
    const body = await req.json();
    const criteria = dealShopMatchSchema.parse(body);

    const allFunders = await db.select().from(funders).where(eq(funders.companyId, ctx.companyId));
    if (!allFunders.length) return NextResponse.json({ matched: [], excluded: [] });

    const funderIds = allFunders.map((f) => f.id);
    const [states, industries, assignments, tiers] = await Promise.all([
      db.select().from(funderRestrictedStates).where(inArray(funderRestrictedStates.funderId, funderIds)),
      db.select().from(funderRestrictedIndustries).where(inArray(funderRestrictedIndustries.funderId, funderIds)),
      db.select().from(funderTierAssignments).where(inArray(funderTierAssignments.funderId, funderIds)),
      db.select().from(funderTiers).where(eq(funderTiers.companyId, ctx.companyId)),
    ]);

    const stateMap = new Map<string, string[]>();
    for (const r of states) {
      const arr = stateMap.get(r.funderId) ?? [];
      arr.push(r.stateCode);
      stateMap.set(r.funderId, arr);
    }
    const indMap = new Map<string, string[]>();
    for (const r of industries) {
      const arr = indMap.get(r.funderId) ?? [];
      arr.push(r.industry);
      indMap.set(r.funderId, arr);
    }
    const tierById = new Map(tiers.map((t) => [t.id, t]));
    const assignmentsByFunder = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const arr = assignmentsByFunder.get(a.funderId) ?? [];
      arr.push(a);
      assignmentsByFunder.set(a.funderId, arr);
    }

    // Expand each funder into one candidate per tier. A funder with two tiers
    // becomes two candidates that match independently with per-tier overrides.
    // A funder with no tier assignments still gets one untiered candidate.
    const candidates: FunderForMatching[] = [];
    for (const f of allFunders) {
      const base = {
        id: f.id,
        name: f.name,
        minRevenue: parseFloat(f.minRevenue),
        maxPositions: f.maxPositions,
        minCreditTier: f.minCreditTier as CreditTier,
        supportsReverseConsolidation: f.supportsReverseConsolidation,
        restrictedStates: stateMap.get(f.id) ?? [],
        restrictedIndustries: indMap.get(f.id) ?? [],
        isActive: f.isActive,
      };
      const myAssignments = assignmentsByFunder.get(f.id) ?? [];
      if (myAssignments.length === 0) {
        candidates.push({ ...base, tierId: null, tierName: null });
      } else {
        for (const a of myAssignments) {
          const t = tierById.get(a.tierId);
          candidates.push({
            ...base,
            tierId: a.tierId,
            tierName: t?.name ?? null,
            tierMaxPositions: a.maxPositions ?? null,
            tierMinRevenue: a.minRevenue != null ? parseFloat(a.minRevenue) : null,
            tierMinCreditTier: (a.minCreditTier as CreditTier | null) ?? null,
          });
        }
      }
    }

    const result = matchAll(criteria, candidates);
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
