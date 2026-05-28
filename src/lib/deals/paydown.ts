/**
 * Deal paydown / portfolio math.
 *
 * Given a deal's funding structure, compute the live tracker values:
 * total payback, per-payment amount, payoff date, % paid in, remaining balance,
 * and renewal eligibility — using MCA-standard timing (4 weeks/month, 5 business
 * days/week).
 */

export const BUSINESS_DAYS_PER_WEEK = 5;
export const WEEKS_PER_MONTH = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RENEWAL_THRESHOLD = 0.5; // 50% paid in → eligible for renewal

export interface PaydownInputs {
  fundedAmount?: number | string | null;
  factorRate?: number | string | null;
  termMode?: string | null;     // 'daily' | 'weekly'
  termCount?: number | string | null;
  fundingDate?: Date | string | null;
  amountCollected?: number | string | null; // total paid so far (optional)
}

export interface Paydown {
  fundedAmount: number;
  factorRate: number;
  totalPayback: number;
  paymentAmount: number;        // per business-day (daily) or per week (weekly)
  termMode: 'daily' | 'weekly' | null;
  termCount: number;
  paymentsTotal: number;        // total number of payments over the term
  fundingDate: Date | null;
  payoffDate: Date | null;      // estimated maturity
  amountCollected: number;      // total paid in (estimated if not supplied)
  remainingBalance: number;
  pctPaidIn: number;            // 0-100
  paymentsMade: number;         // estimated from elapsed time if not supplied
  renewalEligible: boolean;
  renewalDate: Date | null;     // estimated date when 50% paid in
  hasStructure: boolean;        // whether enough data exists to compute
}

function n(v: unknown): number {
  if (v == null) return 0;
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(x) ? 0 : x;
}
function round2(x: number): number { return Math.round((x + Number.EPSILON) * 100) / 100; }

function addBusinessDays(start: Date, businessDays: number): Date {
  const d = new Date(start);
  let remaining = Math.ceil(businessDays);
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--; // skip Sat/Sun
  }
  return d;
}
function addWeeks(start: Date, weeks: number): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return d;
}

/** Count business days elapsed between two dates (cap at 0). */
function businessDaysBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let count = 0;
  const d = new Date(start);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export function computePaydown(inputs: PaydownInputs, now: Date = new Date()): Paydown {
  const fundedAmount = n(inputs.fundedAmount);
  const factorRate = n(inputs.factorRate);
  const termMode = (inputs.termMode === 'daily' || inputs.termMode === 'weekly') ? inputs.termMode : null;
  const termCount = n(inputs.termCount);
  const fundingDate = inputs.fundingDate ? new Date(inputs.fundingDate) : null;
  const fdValid = fundingDate && !isNaN(fundingDate.getTime()) ? fundingDate : null;

  const totalPayback = round2(fundedAmount * factorRate);
  const paymentsTotal = termMode === 'daily'
    ? termCount                       // termCount = number of daily payments
    : termCount;                      // termCount = number of weeks
  const paymentAmount = paymentsTotal > 0 ? round2(totalPayback / paymentsTotal) : 0;

  const hasStructure = fundedAmount > 0 && factorRate > 0 && termMode != null && termCount > 0;

  // Payoff (maturity) date
  let payoffDate: Date | null = null;
  if (fdValid && termMode && termCount > 0) {
    payoffDate = termMode === 'daily'
      ? addBusinessDays(fdValid, termCount)
      : addWeeks(fdValid, termCount);
  }

  // Payments made: use supplied collected amount if present; else estimate from
  // elapsed time.
  let paymentsMade = 0;
  let amountCollected = n(inputs.amountCollected);
  const collectedSupplied = inputs.amountCollected != null && String(inputs.amountCollected) !== '';

  if (collectedSupplied && paymentAmount > 0) {
    paymentsMade = Math.min(paymentsTotal, amountCollected / paymentAmount);
  } else if (fdValid && termMode && paymentAmount > 0) {
    paymentsMade = termMode === 'daily'
      ? Math.min(termCount, businessDaysBetween(fdValid, now))
      : Math.min(termCount, Math.floor((now.getTime() - fdValid.getTime()) / (MS_PER_DAY * 7)));
    amountCollected = round2(paymentsMade * paymentAmount);
  }

  const remainingBalance = round2(Math.max(0, totalPayback - amountCollected));
  const pctPaidIn = totalPayback > 0 ? Math.min(100, round2((amountCollected / totalPayback) * 100)) : 0;

  // Renewal eligibility: 50% paid in.
  const renewalEligible = pctPaidIn >= RENEWAL_THRESHOLD * 100;
  let renewalDate: Date | null = null;
  if (fdValid && termMode && termCount > 0) {
    const paymentsToRenewal = paymentsTotal * RENEWAL_THRESHOLD;
    renewalDate = termMode === 'daily'
      ? addBusinessDays(fdValid, paymentsToRenewal)
      : addWeeks(fdValid, paymentsToRenewal);
  }

  return {
    fundedAmount, factorRate, totalPayback, paymentAmount, termMode, termCount, paymentsTotal,
    fundingDate: fdValid, payoffDate, amountCollected: round2(amountCollected), remainingBalance,
    pctPaidIn, paymentsMade: Math.round(paymentsMade), renewalEligible, renewalDate, hasStructure,
  };
}

/** Status display metadata: label + color tone for the 10 portfolio statuses (+ legacy). */
export const DEAL_STATUS_META: Record<string, { label: string; tone: string }> = {
  // modern workflow (the only statuses shown in the UI)
  submitted: { label: 'Submitted', tone: 'amber' },
  waiting_on_offer: { label: 'Waiting on Offer', tone: 'blue' },
  offer: { label: 'Offer', tone: 'violet' },
  funded: { label: 'Funded', tone: 'emerald' },
  declined: { label: 'Declined', tone: 'rose' },
  // legacy / other values — kept only so existing rows still display sensibly
  active: { label: 'Active', tone: 'blue' },
  not_active: { label: 'Not Active', tone: 'gray' },
  pending_funding: { label: 'Pending Funding', tone: 'amber' },
  payment_issues: { label: 'Payment Issues', tone: 'orange' },
  eligible_for_renewal: { label: 'Eligible for Renewal', tone: 'teal' },
  renewal_sent: { label: 'Renewal Sent', tone: 'cyan' },
  default: { label: 'Default', tone: 'rose' },
  in_collections: { label: 'In Collections', tone: 'red' },
  paid_off: { label: 'Paid Off', tone: 'emerald' },
  closed: { label: 'Closed', tone: 'gray' },
  on_hold: { label: 'On Hold', tone: 'slate' },
  shopping: { label: 'Submitted (legacy)', tone: 'amber' },
  dead: { label: 'Declined (legacy)', tone: 'rose' },
};

/** The ONLY statuses shown in editors/filters. */
export const DEAL_STATUS_OPTIONS = [
  'submitted', 'waiting_on_offer', 'offer', 'funded', 'declined',
] as const;

export interface ScheduledPayment {
  index: number;
  date: Date;
  amount: number;
  cumulative: number;
  isPast: boolean;
}

/**
 * Generate the estimated payment schedule. Daily = business days (skips
 * weekends), weekly = every 7 days from the funding date. Capped at 400 rows.
 */
export function buildPaymentSchedule(inputs: PaydownInputs, now: Date = new Date()): ScheduledPayment[] {
  const p = computePaydown(inputs, now);
  if (!p.hasStructure || !p.fundingDate || p.paymentAmount <= 0) return [];
  const count = Math.min(400, Math.round(p.paymentsTotal));
  const out: ScheduledPayment[] = [];
  let cumulative = 0;
  const cursor = new Date(p.fundingDate);
  for (let i = 1; i <= count; i++) {
    if (p.termMode === 'daily') {
      do { cursor.setDate(cursor.getDate() + 1); } while (cursor.getDay() === 0 || cursor.getDay() === 6);
    } else {
      cursor.setDate(cursor.getDate() + 7);
    }
    cumulative = Math.round((cumulative + p.paymentAmount) * 100) / 100;
    out.push({ index: i, date: new Date(cursor), amount: p.paymentAmount, cumulative, isPast: cursor.getTime() <= now.getTime() });
  }
  return out;
}
