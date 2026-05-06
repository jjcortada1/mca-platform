import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { funders, funderRestrictedStates, funderRestrictedIndustries } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { dealShopMatchSchema } from '@/lib/validation/schemas';
import { matchAllFunders, type FunderForMatching } from '@/lib/matching/engine';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('deals.shop');
    const body = await req.json();
    const criteria = dealShopMatchSchema.parse(body);

    const allFunders = await db.select().from(funders).where(eq(funders.companyId, ctx.companyId));
    if (!allFunders.length) return NextResponse.json({ matched: [], excluded: [] });

    const funderIds = allFunders.map((f) => f.id);
    const states = await db
      .select()
      .from(funderRestrictedStates)
      .where(inArray(funderRestrictedStates.funderId, funderIds));
    const industries = await db
      .select()
      .from(funderRestrictedIndustries)
      .where(inArray(funderRestrictedIndustries.funderId, funderIds));

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

    const forMatching: FunderForMatching[] = allFunders.map((f) => ({
      id: f.id,
      name: f.name,
      minRevenue: parseFloat(f.minRevenue),
      maxPositions: f.maxPositions,
      minCreditTier: f.minCreditTier,
      supportsReverseConsolidation: f.supportsReverseConsolidation,
      restrictedStates: stateMap.get(f.id) ?? [],
      restrictedIndustries: indMap.get(f.id) ?? [],
      isActive: f.isActive,
    }));

    const result = matchAllFunders(criteria, forMatching);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
