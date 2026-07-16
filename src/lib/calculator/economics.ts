/**
 * Deal economics — forward math shared by every place funding details are
 * entered (Mark Funded modal, Funded Deals editor, Refinance modal). Pure
 * functions, tolerant of partially-filled forms: anything that can't be
 * derived yet comes back null instead of NaN.
 *
 * Conventions (same as lib/calculator/mca.ts and lib/deals/paydown.ts):
 *   Total payback   = funding × factor rate
 *   Payments        = termCount (daily → business days, weekly → weeks)
 *   Payment         = payback ÷ payments
 *   Fee amount      = funding × fee%       (origination, off the top)
 *   Net to merchant = funding − fee amount
 *   Cost of capital = payback − net (what the merchant pays above what
 *                     they actually received)
 */

export interface EconomicsInput {
  fundedAmount?: number | string | null;
  factorRate?: number | string | null;
  feePct?: number | string | null;
  termMode?: 'daily' | 'weekly' | string | null;
  termCount?: number | string | null;
  /** Optional commission % (of funding). */
  commissionPct?: number | string | null;
}

export interface EconomicsResult {
  fundedAmount: number | null;
  totalPayback: number | null;
  paymentAmount: number | null;
  numberOfPayments: number | null;
  paymentLabel: string;            // "per business day" | "per week" | ""
  feeAmount: number | null;
  netToMerchant: number | null;
  costOfCapital: number | null;
  costOfCapitalPct: number | null; // vs funding, e.g. 42.0
  commissionAmount: number | null;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeEconomics(input: EconomicsInput): EconomicsResult {
  const funding = num(input.fundedAmount);
  const factor = num(input.factorRate);
  const feePct = num(input.feePct);
  const term = num(input.termCount);
  const commissionPct = num(input.commissionPct);
  const mode = input.termMode === 'weekly' ? 'weekly' : input.termMode === 'daily' ? 'daily' : null;

  const payback = funding !== null && factor !== null && factor > 0
    ? round2(funding * factor) : null;

  const nPayments = term !== null && term > 0 ? Math.round(term) : null;
  const paymentAmount = payback !== null && nPayments !== null && nPayments > 0
    ? round2(payback / nPayments) : null;
  const paymentLabel = mode === 'daily' ? 'per business day' : mode === 'weekly' ? 'per week' : '';

  const feeAmount = funding !== null && feePct !== null
    ? round2(funding * (feePct / 100)) : null;
  const netToMerchant = funding !== null
    ? round2(funding - (feeAmount ?? 0)) : null;

  const costOfCapital = payback !== null && netToMerchant !== null
    ? round2(payback - netToMerchant) : null;
  const costOfCapitalPct = costOfCapital !== null && funding !== null && funding > 0
    ? round2((costOfCapital / funding) * 100) : null;

  const commissionAmount = funding !== null && commissionPct !== null
    ? round2(funding * (commissionPct / 100)) : null;

  return {
    fundedAmount: funding,
    totalPayback: payback,
    paymentAmount,
    numberOfPayments: nPayments,
    paymentLabel,
    feeAmount,
    netToMerchant,
    costOfCapital,
    costOfCapitalPct,
    commissionAmount,
  };
}

/** $12,345.67 — full currency with commas + cents. */
export function fmtMoney2(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** $12,346 — whole-dollar currency for compact summaries. */
export function fmtMoney0(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
