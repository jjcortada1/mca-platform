/**
 * Reverse MCA structure engine.
 *
 * Given the KNOWN payment amount + frequency (and optionally the merchant's
 * observed monthly deposits/revenue for a sanity check), find the most likely
 * real MCA structures.
 *
 * MCA math (simple factor-rate model):
 *   Total Payback   = Funding × Factor
 *   Origination Fee = Funding × Fee%
 *   Net to Merchant = Funding − Origination Fee
 *   Payment × Number of Payments = Total Payback
 *     weekly: Number of Payments = term (weeks)
 *     daily : Number of Payments = term (weeks) × 5 business days
 *
 * Allowed ranges: factor 1.10–1.55, fee 0–20%, term 1–60 weeks.
 *
 * Strategy: enumerate combinations of (funding, factor, fee, term), compute the
 * payment each structure would produce, and rank by how closely that matches
 * the entered payment — with big bonuses for CLEAN, realistic MCA numbers
 * (round funding, common factor/fee/term). We seed the search with clean
 * values first, then add exact-solved (possibly non-clean) structures so
 * there's always a near-perfect-math option even when nothing clean lines up.
 */

import type { PaymentFrequency } from './mca';

export const BUSINESS_DAYS_PER_WEEK = 5;

// Clean values a real funder actually writes — scored higher.
const CLEAN_FUNDING = [
  10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 50_000, 60_000,
  75_000, 100_000, 125_000, 150_000, 175_000, 200_000, 250_000, 300_000,
  350_000, 400_000, 500_000, 750_000, 1_000_000,
];
const COMMON_FACTORS = [1.20, 1.25, 1.30, 1.35, 1.40, 1.45, 1.49, 1.50];
const ALL_FACTORS = [1.10, 1.15, 1.20, 1.25, 1.28, 1.30, 1.35, 1.38, 1.40, 1.42, 1.45, 1.49, 1.50, 1.55];
const COMMON_FEES = [0, 2, 3, 4, 5, 6, 8, 10];
const ALL_FEES = [0, 1, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];
const COMMON_TERMS = [10, 12, 15, 20, 26, 30, 35, 40, 45, 52, 60]; // weeks

export interface ReverseCalcInput {
  payment: number;                 // known recurring payment (required)
  paymentFrequency: PaymentFrequency;
  deposit?: number;                // optional: observed monthly deposits/revenue (sanity)
  /** Legacy field kept for back-compat; ignored by the new engine. */
  factorRate?: number;
  feeMinPct?: number;
  feeMaxPct?: number;
}

export type Confidence = 'very_likely' | 'strong' | 'possible' | 'low';

export interface ReverseCandidate {
  fundingAmount: number;
  factorRate: number;
  feePct: number;
  feeAmount: number;
  netToMerchant: number;
  totalPayback: number;
  termWeeks: number;
  numberOfPayments: number;
  paymentFrequency: PaymentFrequency;
  /** The payment THIS structure produces. */
  computedPayment: number;
  /** computedPayment − enteredPayment (signed). */
  paymentDiff: number;
  /** 0–100. */
  accuracy: number;
  confidence: Confidence;
  confidenceLabel: string;
  isClean: boolean;
  reasons: string[];

  // --- back-compat aliases (old field names used elsewhere) ---
  estimatedFundingAmount: number;
  estimatedFeePct: number;
  estimatedFeeAmount: number;
  estimatedPayback: number;
  estimatedTermWeeks: number;
  estimatedTermDays: number;
  cleanScore: number;
  notes: string[];
}

function numPayments(termWeeks: number, freq: PaymentFrequency): number {
  return freq === 'daily' ? termWeeks * BUSINESS_DAYS_PER_WEEK : termWeeks;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
function isCleanFunding(a: number): boolean {
  // Within 0.5% of a round $5K (≤100K) or $10K (>100K) increment.
  const inc = a > 100_000 ? 10_000 : 5_000;
  const nearest = Math.round(a / inc) * inc;
  return nearest > 0 && Math.abs(a - nearest) / a < 0.005;
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  very_likely: 'Very likely match',
  strong: 'Strong possible match',
  possible: 'Possible but less clean',
  low: 'Low-confidence estimate',
};

/**
 * Score a fully-specified structure against the entered payment.
 * Payment closeness dominates; cleanliness + realism add on top.
 */
function scoreStructure(
  funding: number, factor: number, feePct: number, termWeeks: number,
  entered: number, freq: PaymentFrequency, deposit?: number,
): ReverseCandidate | null {
  if (funding <= 0 || factor < 1.10 || factor > 1.55) return null;
  if (feePct < 0 || feePct > 20) return null;
  if (termWeeks < 1 || termWeeks > 60) return null;

  const n = numPayments(termWeeks, freq);
  if (n <= 0) return null;
  const payback = funding * factor;
  const computedPayment = payback / n;
  const diff = computedPayment - entered;
  const absPct = entered > 0 ? Math.abs(diff) / entered : 1;

  // Payment closeness — 0..70. Exact = 70; 5% off ≈ 45; 10% ≈ 25; ≥20% → ~0.
  let paymentScore: number;
  if (absPct <= 0.002) paymentScore = 70;
  else if (absPct >= 0.20) paymentScore = 0;
  else paymentScore = Math.max(0, 70 - Math.pow(absPct / 0.05, 1.25) * 25);

  // Cleanliness — 0..24.
  const fundingClean = isCleanFunding(funding);
  const factorCommon = COMMON_FACTORS.includes(round2(factor));
  const feeCommon = COMMON_FEES.includes(round2(feePct));
  const termCommon = COMMON_TERMS.includes(termWeeks);
  const cleanScore =
    (fundingClean ? 9 : 0) +
    (factorCommon ? 6 : 0) +
    (feeCommon ? 4 : 0) +
    (termCommon ? 5 : 0);

  // Deposit sanity — 0..6. A funder rarely advances more than ~1.5× the
  // merchant's MONTHLY deposits. If deposit is given and funding is in a
  // sane band relative to it, add points; if wildly off, subtract.
  let sanityScore = 0;
  const reasons: string[] = [];
  if (deposit && deposit > 0) {
    const ratio = funding / deposit;
    if (ratio >= 0.3 && ratio <= 1.5) { sanityScore = 6; reasons.push('Funding is realistic vs the merchant’s deposits'); }
    else if (ratio > 1.5 && ratio <= 2.5) sanityScore = 3;
    else { sanityScore = -6; reasons.push('Funding looks high vs the merchant’s deposits'); }
  }

  const accuracy = Math.max(0, Math.min(100, Math.round(paymentScore + cleanScore + sanityScore + 30 * (paymentScore / 70) * 0)));
  // (paymentScore up to 70 + clean 24 + sanity 6 = 100 ceiling)

  // Confidence tiers.
  let confidence: Confidence;
  if (absPct <= 0.01 && fundingClean && (factorCommon || termCommon)) confidence = 'very_likely';
  else if (absPct <= 0.03 && (fundingClean || factorCommon)) confidence = 'strong';
  else if (absPct <= 0.08) confidence = 'possible';
  else confidence = 'low';

  // Human-readable reasons.
  if (absPct <= 0.002) reasons.unshift('Payment math is exact');
  else reasons.unshift(`Payment is within ${(absPct * 100).toFixed(1)}% of the amount entered`);
  if (fundingClean) reasons.push('Round funding amount');
  if (factorCommon) reasons.push(`Common factor rate (${factor.toFixed(2)})`);
  if (feeCommon) reasons.push(`Common fee (${feePct}%)`);
  if (termCommon) reasons.push(`Common term (${termWeeks} weeks)`);

  const feeAmount = funding * (feePct / 100);
  return {
    fundingAmount: round2(funding),
    factorRate: round2(factor),
    feePct: round2(feePct),
    feeAmount: round2(feeAmount),
    netToMerchant: round2(funding - feeAmount),
    totalPayback: round2(payback),
    termWeeks,
    numberOfPayments: n,
    paymentFrequency: freq,
    computedPayment: round2(computedPayment),
    paymentDiff: round2(diff),
    accuracy,
    confidence,
    confidenceLabel: CONFIDENCE_LABEL[confidence],
    isClean: fundingClean && factorCommon && termCommon,
    reasons,
    // back-compat aliases
    estimatedFundingAmount: round2(funding),
    estimatedFeePct: round2(feePct),
    estimatedFeeAmount: round2(feeAmount),
    estimatedPayback: round2(payback),
    estimatedTermWeeks: termWeeks,
    estimatedTermDays: freq === 'daily' ? n : termWeeks * BUSINESS_DAYS_PER_WEEK,
    cleanScore: accuracy,
    notes: reasons,
  };
}

export function reverseCalculate(input: ReverseCalcInput): ReverseCandidate[] {
  const entered = input.payment;
  const freq = input.paymentFrequency;
  const deposit = input.deposit && input.deposit > 0 ? input.deposit : undefined;
  if (!entered || entered <= 0) return [];

  const out: ReverseCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: ReverseCandidate | null) => {
    if (!c) return;
    const key = `${c.fundingAmount}|${c.factorRate}|${c.feePct}|${c.termWeeks}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  // 1) CLEAN grid — clean funding × common factor × common fee × common term.
  for (const funding of CLEAN_FUNDING) {
    for (const factor of COMMON_FACTORS) {
      for (const term of COMMON_TERMS) {
        for (const fee of COMMON_FEES) {
          push(scoreStructure(funding, factor, fee, term, entered, freq, deposit));
        }
      }
    }
  }

  // 2) EXACT-solved structures — for each common factor + term, solve the
  //    funding that reproduces the entered payment to the penny (may be
  //    non-clean). Guarantees near-exact options even when nothing clean fits.
  for (const factor of ALL_FACTORS) {
    for (const term of COMMON_TERMS) {
      const n = numPayments(term, freq);
      const payback = entered * n;
      const funding = payback / factor;
      for (const fee of ALL_FEES) {
        push(scoreStructure(funding, factor, fee, term, entered, freq, deposit));
      }
    }
  }

  // Keep only structures whose payment is within a usable band, then rank.
  const ranked = out
    .filter((c) => Math.abs(c.paymentDiff) / entered <= 0.12)
    .sort((a, b) => {
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      // Tie-break: closer payment, then cleaner.
      const ad = Math.abs(a.paymentDiff), bd = Math.abs(b.paymentDiff);
      if (ad !== bd) return ad - bd;
      return (b.isClean ? 1 : 0) - (a.isClean ? 1 : 0);
    });

  // De-dupe near-identical funding+term so the top list shows variety.
  const top: ReverseCandidate[] = [];
  const shape = new Set<string>();
  for (const c of ranked) {
    const s = `${Math.round(c.fundingAmount / 1000)}|${c.termWeeks}|${c.factorRate}`;
    if (shape.has(s)) continue;
    shape.add(s);
    top.push(c);
    if (top.length >= 6) break;
  }
  return top;
}
