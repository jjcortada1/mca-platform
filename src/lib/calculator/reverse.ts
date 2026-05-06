/**
 * Reverse Calculator
 *
 * Goal: given an observed deposit amount + recurring payment, estimate the most likely
 * MCA structure (funded amount, factor rate, term).
 *
 * Approach:
 *   1. Sweep fees from feeMin% to feeMax% in 0.25% steps.
 *   2. For each fee%, compute fundingAmount = deposit / (1 - fee%).
 *   3. payback = fundingAmount * factorRate.
 *   4. If daily: term_days = payback / payment. If weekly: term_weeks = payback / payment.
 *   5. Score "cleanness": funded amount close to a round number AND term close to standard
 *      lengths (60/80/90/100/120/150/180 days, or 12/16/20/26/52 weeks).
 *   6. Return top 5 candidates ranked by cleanness.
 */

import type { PaymentFrequency } from './mca';

export interface ReverseCalcInput {
  deposit: number; // observed deposit hitting the bank
  factorRate: number;
  payment: number; // observed recurring payment
  paymentFrequency: PaymentFrequency;
  feeMinPct?: number; // default 2
  feeMaxPct?: number; // default 10
}

export interface ReverseCandidate {
  estimatedFundingAmount: number;
  estimatedFeePct: number;
  estimatedFeeAmount: number;
  estimatedPayback: number;
  estimatedTermDays: number;
  estimatedTermWeeks: number;
  numberOfPayments: number;
  factorRate: number;
  paymentFrequency: PaymentFrequency;
  cleanScore: number; // higher = cleaner, more likely
  notes: string[];
}

const STANDARD_TERMS_DAYS = [40, 60, 80, 90, 100, 120, 150, 180, 200, 240, 270, 300];
const STANDARD_TERMS_WEEKS = [8, 12, 16, 20, 26, 32, 40, 52];
const ROUND_FUNDING_INCREMENTS = [1000, 2500, 5000, 10000, 25000, 50000];

function nearestStandardTerm(value: number, standards: number[]): { term: number; diff: number } {
  let best = standards[0];
  let bestDiff = Math.abs(value - best);
  for (const s of standards) {
    const d = Math.abs(value - s);
    if (d < bestDiff) {
      best = s;
      bestDiff = d;
    }
  }
  return { term: best, diff: bestDiff };
}

function fundingCleanness(amount: number): number {
  // Highest "cleanness" if amount is divisible by largest increment.
  for (let i = ROUND_FUNDING_INCREMENTS.length - 1; i >= 0; i--) {
    const inc = ROUND_FUNDING_INCREMENTS[i];
    if (Math.abs(amount - Math.round(amount / inc) * inc) / inc < 0.05) {
      return i + 1; // 1..6
    }
  }
  return 0;
}

export function reverseCalculate(input: ReverseCalcInput): ReverseCandidate[] {
  const { deposit, factorRate, payment, paymentFrequency } = input;
  const feeMin = input.feeMinPct ?? 2;
  const feeMax = input.feeMaxPct ?? 10;

  if (deposit <= 0 || payment <= 0 || factorRate <= 1) return [];

  const candidates: ReverseCandidate[] = [];
  const standards = paymentFrequency === 'daily' ? STANDARD_TERMS_DAYS : STANDARD_TERMS_WEEKS;

  for (let fee = feeMin; fee <= feeMax + 0.001; fee += 0.25) {
    const feePct = round2(fee);
    const feeFraction = feePct / 100;
    if (feeFraction >= 1) continue;

    const fundingAmount = deposit / (1 - feeFraction);
    const payback = fundingAmount * factorRate;
    const rawTerm = payback / payment;
    const numberOfPayments = Math.round(rawTerm);
    const termDays = paymentFrequency === 'daily' ? numberOfPayments : numberOfPayments * 5;
    const termWeeks = paymentFrequency === 'weekly' ? numberOfPayments : numberOfPayments / 5;

    const fundingScore = fundingCleanness(fundingAmount);
    const { diff: termDiff } = nearestStandardTerm(numberOfPayments, standards);
    // Normalize term closeness: 0 diff = great, larger diff = worse
    const termScore = Math.max(0, 5 - termDiff);

    const notes: string[] = [];
    if (fundingScore >= 4) notes.push('Funding amount is a clean round number');
    if (termDiff <= 1) notes.push('Term matches standard length');
    if (feePct === 5 || feePct === 7 || feePct === 10) notes.push('Common fee tier');

    candidates.push({
      estimatedFundingAmount: round2(fundingAmount),
      estimatedFeePct: feePct,
      estimatedFeeAmount: round2(fundingAmount * feeFraction),
      estimatedPayback: round2(payback),
      estimatedTermDays: termDays,
      estimatedTermWeeks: round2(termWeeks),
      numberOfPayments,
      factorRate,
      paymentFrequency,
      cleanScore: fundingScore * 2 + termScore,
      notes,
    });
  }

  // Sort by cleanScore desc, then by closeness of funding amount to round
  candidates.sort((a, b) => b.cleanScore - a.cleanScore);

  // Return top 5 distinct candidates
  return candidates.slice(0, 5);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
