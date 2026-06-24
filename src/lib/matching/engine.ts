/**
 * Deal Shop Matching Engine
 *
 * Pure function: given deal criteria + a list of (funder, tier) candidates,
 * returns matched and excluded results with reasons. No DB calls, no side
 * effects.
 *
 * A single funder can appear in multiple tiers, each with its own per-tier
 * overrides (max_positions, min_revenue, min_credit_tier). The engine
 * evaluates each (funder, tier) pair independently. So a funder in
 * "A-Paper" (max 2 positions) and "Subprime" (max 4 positions) will be
 * EXCLUDED from A-Paper but MATCHED in Subprime for a 3-position deal.
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

/**
 * A candidate is one (funder, tier-or-untiered) pair. Per-tier override
 * columns on the assignment table can shadow the funder's base values.
 * Untiered candidates carry `tierName: null` and use base values directly.
 */
export interface FunderForMatching {
  id: string;
  name: string;
  // Base values from the funder row
  minRevenue: number;
  maxPositions: number;
  minCreditTier: CreditTier;
  supportsReverseConsolidation: boolean;
  restrictedStates: string[];
  restrictedIndustries: string[];
  isActive: boolean;
  // Tier context — present when this candidate is a (funder, tier) pair.
  tierId?: string | null;
  tierName?: string | null;
  // Per-tier overrides. NULL = use base value.
  tierMaxPositions?: number | null;
  tierMinRevenue?: number | null;
  tierMinCreditTier?: CreditTier | null;
}

/**
 * Short categorical codes for restrictions. Used by the deal-shop UI to
 * render a compact "why excluded" badge per funder (e.g. "Credit Too Low",
 * "Revenue Too Low") instead of the long sentence-form reason text.
 *
 * One funder can match against multiple codes if several criteria fail.
 * Codes are stable identifiers; the human label rendering is done in the UI.
 */
export type ExclusionCode =
  | 'restricted_state'
  | 'restricted_industry'
  | 'credit_too_low'
  | 'revenue_too_low'
  | 'positions_too_high'
  | 'reverse_unsupported'
  | 'inactive';

export interface MatchResult {
  funderId: string;
  funderName: string;
  // The tier this match was evaluated under (null = no tier / "Untiered").
  tierId: string | null;
  tierName: string | null;
  matched: boolean;
  reasons: string[];
  // Compact categorical codes for the reasons this match was EXCLUDED.
  // Empty array for matched results. UI uses these to render short labels.
  reasonCodes: ExclusionCode[];
  // Per-candidate effective values used for matching (after override resolution).
  effectiveMaxPositions: number;
  effectiveMinRevenue: number;
  effectiveMinCreditTier: CreditTier;
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
  // Resolve effective values (override > base)
  const effectiveMaxPositions = funder.tierMaxPositions ?? funder.maxPositions;
  const effectiveMinRevenue = funder.tierMinRevenue ?? funder.minRevenue;
  const effectiveMinCreditTier = funder.tierMinCreditTier ?? funder.minCreditTier;

  const baseResult: MatchResult = {
    funderId: funder.id,
    funderName: funder.name,
    tierId: funder.tierId ?? null,
    tierName: funder.tierName ?? null,
    matched: true,
    reasons: [],
    reasonCodes: [],
    effectiveMaxPositions,
    effectiveMinRevenue,
    effectiveMinCreditTier,
  };

  if (!funder.isActive) {
    return { ...baseResult, matched: false, reasons: ['Funder inactive'], reasonCodes: ['inactive'] };
  }

  const reasons: string[] = [];
  const reasonCodes: ExclusionCode[] = [];
  let matched = true;

  // Reverse consolidation gate
  if (criteria.dealType === 'reverse_consolidation') {
    if (!funder.supportsReverseConsolidation) {
      matched = false;
      reasons.push('Does not support reverse consolidation');
      reasonCodes.push('reverse_unsupported');
    } else {
      reasons.push('Supports reverse consolidation');
    }
  }

  // Revenue (uses effective)
  if (criteria.monthlyRevenue < effectiveMinRevenue) {
    matched = false;
    reasons.push(`Min revenue ${fmtMoney(effectiveMinRevenue)}, deal has ${fmtMoney(criteria.monthlyRevenue)}`);
    reasonCodes.push('revenue_too_low');
  } else {
    reasons.push(`Revenue OK (min ${fmtMoney(effectiveMinRevenue)})`);
  }

  // Positions (uses effective)
  if (criteria.positions > effectiveMaxPositions) {
    matched = false;
    reasons.push(`Max positions ${effectiveMaxPositions}${funder.tierName ? ` in ${funder.tierName}` : ''}, deal has ${criteria.positions}`);
    reasonCodes.push('positions_too_high');
  } else {
    reasons.push(`Positions OK (max ${effectiveMaxPositions}${funder.tierName ? ` in ${funder.tierName}` : ''})`);
  }

  // Credit — score-floor comparison (uses effective)
  const dealFloor = dealScoreFloor(criteria);
  const funderFloor = TIER_TO_FLOOR[effectiveMinCreditTier];
  if (dealFloor !== null && funderFloor !== null && dealFloor < funderFloor) {
    matched = false;
    reasons.push(
      `Funder requires ${CREDIT_TIER_LABEL[effectiveMinCreditTier]}, deal scores ~${dealFloor}`
    );
    reasonCodes.push('credit_too_low');
  } else if (dealFloor !== null && funderFloor !== null) {
    reasons.push(`Credit OK (need ≥${funderFloor}, have ≥${dealFloor})`);
  }

  // State restrictions (funder-level only)
  if (criteria.state && criteria.state !== 'other') {
    if (funder.restrictedStates.map((s) => s.toUpperCase()).includes(criteria.state.toUpperCase())) {
      matched = false;
      reasons.push(`Funder does not lend in ${criteria.state}`);
      reasonCodes.push('restricted_state');
    } else {
      reasons.push(`State OK (${criteria.state})`);
    }
  }

  // Industry restrictions (funder-level only)
  if (criteria.industry && criteria.industry !== 'other') {
    const restricted = funder.restrictedIndustries.map((i) => i.toLowerCase());
    if (restricted.includes(criteria.industry.toLowerCase())) {
      matched = false;
      reasons.push(`Funder does not lend to ${criteria.industry}`);
      reasonCodes.push('restricted_industry');
    } else {
      reasons.push(`Industry OK`);
    }
  }

  return { ...baseResult, matched, reasons, reasonCodes };
}

export function matchAll(criteria: DealCriteria, candidates: FunderForMatching[]): {
  matched: MatchResult[];
  excluded: MatchResult[];
} {
  const matched: MatchResult[] = [];
  const excluded: MatchResult[] = [];
  for (const f of candidates) {
    const result = matchFunder(criteria, f);
    if (result.matched) matched.push(result);
    else excluded.push(result);
  }
  return { matched, excluded };
}
