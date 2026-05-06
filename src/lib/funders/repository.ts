/**
 * Funder repository helpers — used by the matching engine and the funders UI.
 * Handles hydration of nested data (tiers, contacts, restrictions) cleanly.
 */

import { db } from '@/lib/db/client';
import {
  funders,
  funderTiers,
  funderTierAssignments,
  funderContacts,
  funderRestrictedStates,
  funderRestrictedIndustries,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import type { FunderForMatching, CreditTier } from '@/lib/matching/engine';

export interface HydratedFunder {
  id: string;
  name: string;
  submissionMethod: 'email' | 'portal';
  supportsReverseConsolidation: boolean;
  minRevenue: number;
  maxPositions: number;
  minCreditTier: CreditTier;
  notes: string | null;
  isActive: boolean;
  tierIds: string[];
  tierNames: string[];
  contacts: { id: string; name: string; phone: string | null; email: string | null; isPrimary: boolean }[];
  restrictedStates: string[];
  restrictedIndustries: string[];
}

/**
 * Load all funders for a company with all relations hydrated.
 * Tenant-scoped — pass companyId from requireTenantContext().
 */
export async function loadFunders(companyId: string): Promise<HydratedFunder[]> {
  const fundersList = await db.select().from(funders).where(eq(funders.companyId, companyId));
  if (!fundersList.length) return [];

  const funderIds = fundersList.map((f) => f.id);

  // Parallel fetch all relations in 4 queries
  const [tierAssignments, allTiers, contacts, restrictedStates, restrictedIndustries] = await Promise.all([
    db.select().from(funderTierAssignments).where(inArray(funderTierAssignments.funderId, funderIds)),
    db.select().from(funderTiers).where(eq(funderTiers.companyId, companyId)),
    db.select().from(funderContacts).where(inArray(funderContacts.funderId, funderIds)),
    db.select().from(funderRestrictedStates).where(inArray(funderRestrictedStates.funderId, funderIds)),
    db.select().from(funderRestrictedIndustries).where(inArray(funderRestrictedIndustries.funderId, funderIds)),
  ]);

  const tierMap = new Map(allTiers.map((t) => [t.id, t]));

  return fundersList.map((f): HydratedFunder => {
    const ta = tierAssignments.filter((a) => a.funderId === f.id);
    const tierIds = ta.map((a) => a.tierId);
    const tierNames = tierIds.map((id) => tierMap.get(id)?.name).filter((n): n is string => Boolean(n));

    return {
      id: f.id,
      name: f.name,
      submissionMethod: f.submissionMethod as 'email' | 'portal',
      supportsReverseConsolidation: f.supportsReverseConsolidation,
      minRevenue: parseFloat(String(f.minRevenue)),
      maxPositions: f.maxPositions,
      minCreditTier: f.minCreditTier as CreditTier,
      notes: f.notes,
      isActive: f.isActive,
      tierIds,
      tierNames,
      contacts: contacts
        .filter((c) => c.funderId === f.id)
        .map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, isPrimary: c.isPrimary })),
      restrictedStates: restrictedStates.filter((r) => r.funderId === f.id).map((r) => r.stateCode),
      restrictedIndustries: restrictedIndustries.filter((r) => r.funderId === f.id).map((r) => r.industry),
    };
  });
}

/**
 * Project a HydratedFunder into the lean shape the matching engine wants.
 */
export function toMatchingShape(f: HydratedFunder): FunderForMatching {
  return {
    id: f.id,
    name: f.name,
    minRevenue: f.minRevenue,
    maxPositions: f.maxPositions,
    minCreditTier: f.minCreditTier,
    supportsReverseConsolidation: f.supportsReverseConsolidation,
    restrictedStates: f.restrictedStates,
    restrictedIndustries: f.restrictedIndustries,
    isActive: f.isActive,
  };
}

export async function loadFunder(companyId: string, funderId: string): Promise<HydratedFunder | null> {
  const all = await loadFunders(companyId);
  return all.find((f) => f.id === funderId) ?? null;
}

/**
 * Filter a list of tier IDs to only those that belong to the given company.
 * Defends against cross-tenant tier ID injection on funder create/update.
 */
export async function validateTierIds(companyId: string, tierIds: string[]): Promise<string[]> {
  if (!tierIds.length) return [];
  const valid = await db
    .select({ id: funderTiers.id })
    .from(funderTiers)
    .where(and(eq(funderTiers.companyId, companyId), inArray(funderTiers.id, tierIds)));
  return valid.map((t) => t.id);
}
