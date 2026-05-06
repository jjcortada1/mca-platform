/**
 * MCA Calculator + Commission Logic
 *
 * Commission table (defaults):
 *   < 1.32        → 0%
 *   1.32 – 1.349  → 3%
 *   1.35 – 1.369  → 5%
 *   1.37 – 1.398  → 6%
 *   1.399 – 1.419 → 8%
 *   1.42 – 1.449  → 9%
 *   1.45 – 1.469  → 10%
 *   1.47 – 1.498  → 11%
 *   ≥ 1.499       → 12% (cap)
 *
 * Implementation: ascending list of (threshold, pct). Walk descending; first row with
 * threshold <= factorRate wins. Below the lowest threshold = 0%.
 */

export interface CommissionRule {
  threshold: number; // inclusive ceiling
  commissionPct: number;
}

export const DEFAULT_COMMISSION_RULES: CommissionRule[] = [
  { threshold: 1.32, commissionPct: 3 },
  { threshold: 1.35, commissionPct: 5 },
  { threshold: 1.37, commissionPct: 6 },
  { threshold: 1.399, commissionPct: 8 },
  { threshold: 1.42, commissionPct: 9 },
  { threshold: 1.45, commissionPct: 10 },
  { threshold: 1.47, commissionPct: 11 },
  { threshold: 1.499, commissionPct: 12 },
];

const COMMISSION_CAP = 12;
const FLOOR_PCT = 0;

export function getCommissionPct(factorRate: number, rules: CommissionRule[] = DEFAULT_COMMISSION_RULES): number {
  if (!rules.length) return FLOOR_PCT;
  const sorted = [...rules].sort((a, b) => a.threshold - b.threshold);

  // Below the lowest threshold → 0%
  if (factorRate < sorted[0].threshold) return FLOOR_PCT;

  // Find highest threshold <= factorRate. Use small epsilon for float safety.
  const EPS = 1e-9;
  let pct = FLOOR_PCT;
  for (const rule of sorted) {
    if (factorRate + EPS >= rule.threshold) pct = rule.commissionPct;
    else break;
  }
  // Cap
  return Math.min(pct, COMMISSION_CAP);
}

export type PaymentFrequency = 'daily' | 'weekly';

export interface MCACalculatorInput {
  fundingAmount: number;
  factorRate: number;
  termDays: number; // total business days
  paymentFrequency: PaymentFrequency;
  feesPct: number; // 0-100, taken off the top
  commissionRules?: CommissionRule[];
}

export interface MCACalculatorOutput {
  fundingAmount: number;
  factorRate: number;
  payback: number;
  feesAmount: number;
  netToMerchant: number;
  termDays: number;
  termWeeks: number;
  paymentFrequency: PaymentFrequency;
  paymentAmount: number;
  numberOfPayments: number;
  commissionPct: number;
  commissionAmount: number;
}

export function calculateMCA(input: MCACalculatorInput): MCACalculatorOutput {
  const { fundingAmount, factorRate, termDays, paymentFrequency, feesPct } = input;
  const rules = input.commissionRules ?? DEFAULT_COMMISSION_RULES;

  const payback = round2(fundingAmount * factorRate);
  const feesAmount = round2(fundingAmount * (feesPct / 100));
  const netToMerchant = round2(fundingAmount - feesAmount);

  // Daily = 5 business days/week. Weekly = 1 payment/week.
  const businessDaysPerWeek = 5;
  const termWeeks = termDays / businessDaysPerWeek;
  const numberOfPayments =
    paymentFrequency === 'daily' ? termDays : Math.max(1, Math.round(termWeeks));
  const paymentAmount = round2(payback / numberOfPayments);

  const commissionPct = getCommissionPct(factorRate, rules);
  const commissionAmount = round2(fundingAmount * (commissionPct / 100));

  return {
    fundingAmount,
    factorRate,
    payback,
    feesAmount,
    netToMerchant,
    termDays,
    termWeeks: round2(termWeeks),
    paymentFrequency,
    paymentAmount,
    numberOfPayments,
    commissionPct,
    commissionAmount,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
