/**
 * Deal Shop Matching Engine
 *
 * Pure function: given deal criteria + a list of funders, returns matched and excluded
 * funders with reasons for each decision. No DB calls, no side effects.
 *
 * Credit handling (backward-compatible):
 *   - Deal criteria can carry EITHER a legacy `creditScore` enum tag OR a numeric
 *     `creditScoreValue` (representing the floor of the deal's credit range).
 *   - Funder.minCreditTier is the legacy enum stored in the DB.
 *   - We map both to a numeric score floor, then compare.
 */

export type CreditTier = 'unknown' | 'under_550' | '550_599' | '600_649' | '650_plus';
export type DealType = 'standard_mca' | 'reverse_consolidation';

export interface DealCriteria {
  monthlyRevenue: number;
  // EITHER legacy enum:
  creditScore?: CreditTier;
  // OR numeric floor (preferred — comes from match_options.meta.minScore):
  creditScoreValue?: number | null;
  positions: number;
  industry: string; // 'other' = ignore
  state: string; // 'other' = ignore
  dealType: DealType;
}

export interface FunderForMatching {
  id: string;
  name: string;
  minRevenue: number;
  maxPositions: number;
  minCreditTier: CreditTier;
  supportsReverseConsolidation: boolean;
  restrictedStates: string[];
  restrictedIndustries: string[];
  isActive: boolean;
}

export interface MatchResult {
  funderId: string;
  funderName: string;
  matched: boolean;
  reasons: string[];
}

// Map enum tier → numeric floor of that range (or null = unknown/no requirement)
const TIER_TO_FLOOR: Record<CreditTier, number | null> = {
  unknown: null,
  under_550: 0,
  '550_599': 550,
  '600_649': 600,
  '650_plus': 650,
};

const CREDIT_TIER_LABEL: Record<CreditTier, string> = {
  unknown: 'Unknown',
  under_550: 'Under 550',
  '550_599': '550–599',
  '600_649': '600–649',
  '650_plus': '650+',
};

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function dealScoreFloor(criteria: DealCriteria): number | null {
  // Numeric floor wins if explicitly provided
  if (criteria.creditScoreValue !== undefined && criteria.creditScoreValue !== null) {
    return criteria.creditScoreValue;
  }
  // Otherwise translate legacy enum
  if (criteria.creditScore) return TIER_TO_FLOOR[criteria.creditScore];
  return null;
}

export function matchFunder(criteria: DealCriteria, funder: FunderForMatching): MatchResult {
  const reasons: string[] = [];
  let matched = true;

  if (!funder.isActive) {
    return { funderId: funder.id, funderName: funder.name, matched: false, reasons: ['Funder inactive'] };
  }

  // Reverse consolidation gate
  if (criteria.dealType === 'reverse_consolidation') {
    if (!funder.supportsReverseConsolidation) {
      matched = false;
      reasons.push('Does not support reverse consolidation');
    } else {
      reasons.push('Supports reverse consolidation');
    }
  }

  // Revenue
  if (criteria.monthlyRevenue < funder.minRevenue) {
    matched = false;
    reasons.push(`Min revenue ${fmtMoney(funder.minRevenue)}, deal has ${fmtMoney(criteria.monthlyRevenue)}`);
  } else {
    reasons.push(`Revenue OK (min ${fmtMoney(funder.minRevenue)})`);
  }

  // Positions
  if (criteria.positions > funder.maxPositions) {
    matched = false;
    reasons.push(`Max positions ${funder.maxPositions}, deal has ${criteria.positions}`);
  } else {
    reasons.push(`Positions OK (max ${funder.maxPositions})`);
  }

  // Credit — score-floor comparison.
  // Skip if deal credit unknown OR funder has no requirement.
  const dealFloor = dealScoreFloor(criteria);
  const funderFloor = TIER_TO_FLOOR[funder.minCreditTier];
  if (dealFloor !== null && funderFloor !== null && dealFloor < funderFloor) {
    matched = false;
    reasons.push(
      `Funder requires ${CREDIT_TIER_LABEL[funder.minCreditTier]}, deal scores ~${dealFloor}`
    );
  } else if (dealFloor !== null && funderFloor !== null) {
    reasons.push(`Credit OK (need ≥${funderFloor}, have ≥${dealFloor})`);
  }

  // State restrictions
  if (criteria.state && criteria.state !== 'other') {
    if (funder.restrictedStates.map((s) => s.toUpperCase()).includes(criteria.state.toUpperCase())) {
      matched = false;
      reasons.push(`Funder does not lend in ${criteria.state}`);
    } else {
      reasons.push(`State OK (${criteria.state})`);
    }
  }

  // Industry restrictions
  if (criteria.industry && criteria.industry !== 'other') {
    const restricted = funder.restrictedIndustries.map((i) => i.toLowerCase());
    if (restricted.includes(criteria.industry.toLowerCase())) {
      matched = false;
      reasons.push(`Funder does not lend to ${criteria.industry}`);
    } else {
      reasons.push(`Industry OK`);
    }
  }

  return { funderId: funder.id, funderName: funder.name, matched, reasons };
}

export function matchAll(criteria: DealCriteria, funders: FunderForMatching[]): {
  matched: MatchResult[];
  excluded: MatchResult[];
} {
  const matched: MatchResult[] = [];
  const excluded: MatchResult[] = [];
  for (const f of funders) {
    const result = matchFunder(criteria, f);
    if (result.matched) matched.push(result);
    else excluded.push(result);
  }
  return { matched, excluded };
}
