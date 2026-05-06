/**
 * Deal Shop Matching Engine
 *
 * Pure function: given deal criteria + a list of funders, returns matched and excluded
 * funders with reasons for each decision. No DB calls, no side effects.
 */

export type CreditTier = 'unknown' | 'under_550' | '550_599' | '600_649' | '650_plus';
export type DealType = 'standard_mca' | 'reverse_consolidation';

export interface DealCriteria {
  monthlyRevenue: number;
  creditScore: CreditTier;
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
  reasons: string[]; // why matched OR why excluded
}

const CREDIT_TIER_RANK: Record<CreditTier, number> = {
  unknown: 0,
  under_550: 1,
  '550_599': 2,
  '600_649': 3,
  '650_plus': 4,
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

  // Credit — only enforced if criteria.creditScore !== 'unknown' AND funder has a real min tier
  if (criteria.creditScore !== 'unknown' && funder.minCreditTier !== 'unknown') {
    const dealRank = CREDIT_TIER_RANK[criteria.creditScore];
    const funderRank = CREDIT_TIER_RANK[funder.minCreditTier];
    if (dealRank < funderRank) {
      matched = false;
      reasons.push(
        `Min credit tier ${CREDIT_TIER_LABEL[funder.minCreditTier]}, deal is ${CREDIT_TIER_LABEL[criteria.creditScore]}`
      );
    } else {
      reasons.push(`Credit OK (min ${CREDIT_TIER_LABEL[funder.minCreditTier]})`);
    }
  } else if (criteria.creditScore === 'unknown') {
    reasons.push('Credit unknown — rule skipped');
  }

  // State — only if not 'other'
  if (criteria.state !== 'other' && criteria.state !== '') {
    if (funder.restrictedStates.includes(criteria.state)) {
      matched = false;
      reasons.push(`State ${criteria.state} restricted`);
    } else {
      reasons.push(`State ${criteria.state} OK`);
    }
  }

  // Industry — only if not 'other'
  if (criteria.industry !== 'other' && criteria.industry !== '') {
    if (funder.restrictedIndustries.includes(criteria.industry)) {
      matched = false;
      reasons.push(`Industry "${criteria.industry}" restricted`);
    } else {
      reasons.push(`Industry "${criteria.industry}" OK`);
    }
  }

  return { funderId: funder.id, funderName: funder.name, matched, reasons };
}

export function matchAllFunders(
  criteria: DealCriteria,
  funders: FunderForMatching[]
): { matched: MatchResult[]; excluded: MatchResult[] } {
  const matched: MatchResult[] = [];
  const excluded: MatchResult[] = [];
  for (const f of funders) {
    const r = matchFunder(criteria, f);
    (r.matched ? matched : excluded).push(r);
  }
  matched.sort((a, b) => a.funderName.localeCompare(b.funderName));
  excluded.sort((a, b) => a.funderName.localeCompare(b.funderName));
  return { matched, excluded };
}
