/**
 * Commission math + lifecycle logic.
 *
 * Source of truth is always the CRM database; these helpers just compute derived
 * values consistently for both the API and the UI.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AUTO_CLEAR_DAYS = 30;

export interface RepCommissionInputs {
  grossCommission: number;
  repSplitPct: number;   // 0-100
  brokerFee?: number;    // optional; rep gets the SAME split % on broker fee too
}

export interface RepCommissionBreakdown {
  repShareOfGross: number;
  repShareOfBrokerFee: number;
  totalRepCommission: number;
}

/**
 * Rep commission = split% of gross commission PLUS the same split% of broker fee.
 * Per spec: "If broker fees exist, rep receives the same split percentage on broker fees."
 */
export function computeRepCommission(inputs: RepCommissionInputs): RepCommissionBreakdown {
  const gross = num(inputs.grossCommission);
  const pct = num(inputs.repSplitPct) / 100;
  const broker = num(inputs.brokerFee);

  const repShareOfGross = round2(gross * pct);
  const repShareOfBrokerFee = round2(broker * pct);
  return {
    repShareOfGross,
    repShareOfBrokerFee,
    totalRepCommission: round2(repShareOfGross + repShareOfBrokerFee),
  };
}

export interface LeadSourceInputs {
  grossCommission: number;
  splitPct?: number | null;     // either this...
  flatAmount?: number | null;   // ...or this
}

/** Lead source commission = flat amount if given, else split% of gross. */
export function computeLeadSourceCommission(inputs: LeadSourceInputs): number {
  if (inputs.flatAmount != null && inputs.flatAmount !== undefined && !isNaN(Number(inputs.flatAmount))) {
    return round2(num(inputs.flatAmount));
  }
  const gross = num(inputs.grossCommission);
  const pct = num(inputs.splitPct) / 100;
  return round2(gross * pct);
}

export interface DealBreakdownInputs {
  grossCommission: number;     // total commission earned on the deal ($)
  brokerFee?: number;          // broker fee in DOLLARS
  repSplitPct: number;         // rep split as a PERCENT (0-100)
  leadSourceSplitPct?: number | null;   // lead source split as a PERCENT, OR
  leadSourceFlatAmount?: number | null; // lead source flat amount in DOLLARS
}

export interface DealBreakdown {
  gross: number;            // gross commission
  brokerFee: number;        // broker fee ($)
  totalPool: number;        // gross + broker fee (what gets split)
  repOwed: number;          // rep split% of (gross + broker fee)
  leadSourceOwed: number;   // lead source flat, or split% of gross
  houseOwed: number;        // remainder kept by the house
}

/**
 * Full per-deal commission breakdown.
 *
 * - Split inputs are PERCENTAGES; broker fee is a DOLLAR amount.
 * - Rep earns their split % of BOTH the gross commission AND the broker fee.
 * - Lead source earns a flat $ amount OR a split % of the gross commission.
 * - House keeps whatever remains: (gross + broker fee) − rep − lead source.
 */
export function computeDealBreakdown(inputs: DealBreakdownInputs): DealBreakdown {
  const gross = num(inputs.grossCommission);
  const brokerFee = num(inputs.brokerFee);
  const totalPool = round2(gross + brokerFee);

  const repPct = num(inputs.repSplitPct) / 100;
  const repOwed = round2((gross + brokerFee) * repPct);

  const leadSourceOwed = computeLeadSourceCommission({
    grossCommission: gross,
    splitPct: inputs.leadSourceSplitPct ?? null,
    flatAmount: inputs.leadSourceFlatAmount ?? null,
  });

  const houseOwed = round2(totalPool - repOwed - leadSourceOwed);
  return { gross, brokerFee, totalPool, repOwed, leadSourceOwed, houseOwed };
}

export interface PayoutTotals {
  total: number;
  paid: number;
  pending: number;
  owed: number;       // total - paid (for non-clawed-back)
  /**
   * Cleared but not yet paid out. Subset of `owed` — specifically the
   * portion that has finished its 30-day pending window and is ready to
   * disburse. `pending` + `available` = `owed`. Same definition the rep
   * & lead-source dashboards use, so the portal can show the same number.
   */
  available: number;
  clawedBack: number;
}

/**
 * Roll up a set of commission rows into portal totals.
 * Each row: { amount, paid, status }.
 */
export function rollupTotals(
  rows: { amount: number; paid: number; status: 'pending' | 'cleared' | 'clawed_back' }[]
): PayoutTotals {
  let total = 0, paid = 0, pending = 0, owed = 0, available = 0, clawedBack = 0;
  for (const r of rows) {
    const amt = num(r.amount);
    const p = num(r.paid);
    if (r.status === 'clawed_back') {
      clawedBack += amt;
      continue; // clawed back doesn't count toward owed
    }
    total += amt;
    paid += p;
    const remaining = Math.max(0, amt - p);
    owed += remaining;
    if (r.status === 'pending') pending += remaining;
    // Cleared & still owing → counts as available to pay out NOW.
    if (r.status === 'cleared') available += remaining;
  }
  return {
    total: round2(total),
    paid: round2(paid),
    pending: round2(pending),
    owed: round2(owed),
    available: round2(available),
    clawedBack: round2(clawedBack),
  };
}

/**
 * Auto-status: a commission stays "pending" for 30 days after the funding date,
 * then becomes "cleared" — UNLESS an admin has manually set it (clawed_back, or
 * manually cleared early). We only auto-advance pending→cleared; we never override
 * a manual clawback.
 *
 * Returns the status the row SHOULD have, given its stored status + funding date.
 */
export function resolveAutoStatus(
  storedStatus: 'pending' | 'cleared' | 'clawed_back',
  fundingDate: Date | string | null | undefined,
  now: Date = new Date()
): 'pending' | 'cleared' | 'clawed_back' {
  if (storedStatus === 'clawed_back') return 'clawed_back';
  if (storedStatus === 'cleared') return 'cleared';
  // storedStatus === 'pending'
  if (!fundingDate) return 'pending';
  const fd = typeof fundingDate === 'string' ? new Date(fundingDate) : fundingDate;
  if (isNaN(fd.getTime())) return 'pending';
  const daysSince = (now.getTime() - fd.getTime()) / MS_PER_DAY;
  return daysSince >= AUTO_CLEAR_DAYS ? 'cleared' : 'pending';
}

/** Days remaining until a pending commission auto-clears (0 if already eligible). */
export function daysUntilCleared(
  fundingDate: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!fundingDate) return null;
  const fd = typeof fundingDate === 'string' ? new Date(fundingDate) : fundingDate;
  if (isNaN(fd.getTime())) return null;
  const daysSince = (now.getTime() - fd.getTime()) / MS_PER_DAY;
  return Math.max(0, Math.ceil(AUTO_CLEAR_DAYS - daysSince));
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const COMMISSION_CONSTANTS = { AUTO_CLEAR_DAYS };
