/**
 * Underwriting scrub engine — deterministic MCA analysis.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO AI. NO API CREDITS. NO NETWORK CALLS.
 * ─────────────────────────────────────────────────────────────────────────
 * Everything here is arithmetic and pattern matching: a funder-name
 * dictionary, recurring-debit clustering, cadence math, and a fixed rule
 * set for the grade. The same statements always produce the same report,
 * which is what you want for underwriting — an underwriter can re-derive
 * every number by hand.
 *
 * What it produces:
 *   • Existing MCA positions (funder, payment, cadence, estimated structure)
 *   • Monthly deposits / revenue / balance behavior
 *   • NSF + negative-day counts
 *   • Holdback burden (MCA debt service as a share of deposits)
 *   • A graded verdict with the specific reasons behind it
 *   • A conservative "room for a new advance" estimate
 *
 * Estimated original advance sizes come from the existing reverse-MCA
 * solver in src/lib/calculator/reverse.ts — the same engine the Reverse
 * Calculator page uses.
 */

import type { Transaction } from './parse';
import { matchKnownFunder, hasWeakMcaHint, isNonMcaRecurring, normalizeDescription } from './funders';
import { reverseCalculate } from '@/lib/calculator/reverse';

/** Business days in an average month — used for daily↔monthly conversion. */
export const BUSINESS_DAYS_PER_MONTH = 21.7;
/** Weeks in an average month. */
export const WEEKS_PER_MONTH = 4.333;

export type Cadence = 'daily' | 'weekly' | 'bi-weekly' | 'semi-weekly' | 'monthly' | 'irregular';

export interface McaPosition {
  id: string;
  /** Known funder name, or the cleaned-up bank descriptor. */
  funderName: string;
  /** Whether the name came from the funder dictionary or the descriptor. */
  identified: boolean;
  /** Representative raw descriptor as it appears on the statement. */
  descriptor: string;
  cadence: Cadence;
  /** Typical (median) debit amount. */
  paymentAmount: number;
  /** Number of debits observed in the uploaded statements. */
  paymentCount: number;
  firstDate: string;
  lastDate: string;
  /** Payment normalized to a per-business-day figure. */
  dailyEquivalent: number;
  /** Payment normalized to a monthly figure. */
  monthlyEquivalent: number;
  /** Total actually debited across the statements. */
  totalDebited: number;
  confidence: 'high' | 'medium' | 'low';
  confidenceReasons: string[];
  /** Reverse-solved original structure (best candidate), when solvable. */
  estimatedFunding: number | null;
  estimatedFactor: number | null;
  estimatedTermWeeks: number | null;
  estimatedPayback: number | null;
  /** True when the advance visibly started inside the statement window. */
  startedInPeriod: boolean;
  /** Remaining balance — only when the start is visible in the statements. */
  estimatedRemaining: number | null;
  estimatedRemainingPct: number | null;
  /** True when payments stopped >21 days before the statement end. */
  likelyPaidOff: boolean;
}

export interface MonthStat {
  key: string;          // YYYY-MM
  label: string;        // "Jan 2026"
  /**
   * Calendar days of this month that the statements actually cover. A
   * statement window starting mid-March leaves March partial, and a
   * partial bucket must not be averaged in as if it were a full month.
   */
  daysCovered: number;
  /** True when the bucket covers less than 20 days. */
  partial: boolean;
  deposits: number;
  depositCount: number;
  /** Deposits excluding transfers, advance proceeds, refunds, reversals. */
  trueRevenue: number;
  withdrawals: number;  // positive number
  net: number;
  mcaDebits: number;
  nsfCount: number;
  negativeDays: number;
  minBalance: number | null;
  avgDailyBalance: number | null;
  endingBalance: number | null;
  largestDeposit: number;
  /** Largest deposit ÷ total deposits. */
  concentrationPct: number;
}

export interface RedFlag {
  severity: 'critical' | 'warning' | 'info';
  label: string;
  detail: string;
}

export interface ScrubCheck {
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'unknown';
  value: string;
  benchmark: string;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'Decline';

export interface UnderwritingReport {
  hasData: boolean;
  transactionCount: number;
  periodStart: string;
  periodEnd: string;
  monthsCovered: number;
  balancesAvailable: boolean;

  months: MonthStat[];
  avgMonthlyDeposits: number;
  avgMonthlyRevenue: number;
  avgMonthlyWithdrawals: number;
  avgMonthlyNet: number;
  avgDepositCount: number;
  avgDailyBalance: number | null;
  lowestBalance: number | null;
  totalNsf: number;
  totalNegativeDays: number;

  positions: McaPosition[];
  positionCount: number;
  totalDailyMca: number;
  totalMonthlyMca: number;
  totalEstimatedPayback: number;
  /** MCA debt service ÷ monthly deposits. */
  holdbackPct: number;
  /** Deposits that look like advance proceeds landing during the period. */
  advanceDepositsFound: { date: string; description: string; amount: number }[];

  score: number;         // 0–100
  grade: Grade;
  verdict: string;
  verdictDetail: string;
  positives: string[];
  redFlags: RedFlag[];
  checks: ScrubCheck[];

  /** Conservative estimate of new funding the file can support. */
  maxNewAdvance: number;
  maxNewAdvanceBasis: string;

  /** Recent MCA debits, newest first (for the activity rail). */
  recentMcaTransactions: { date: string; description: string; amount: number }[];

  warnings: string[];
}

/* ────────────────────────── helpers ────────────────────────── */

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[(m || 1) - 1]} ${y}`;
}

/** Noise tokens stripped before grouping descriptors into payment streams. */
const NOISE_TOKENS = new Set([
  'ACH', 'DEBIT', 'CREDIT', 'WEB', 'PMT', 'PAYMENT', 'PAYMENTS', 'CO', 'ENTRY',
  'DESC', 'ID', 'ORIG', 'NAME', 'TRANSFER', 'TRN', 'EFT', 'WITHDRAWAL', 'DDA',
  'POS', 'RECURRING', 'PPD', 'CCD', 'TEL', 'ARC', 'IAT', 'MEMO', 'REF', 'TYPE',
  'SEC', 'IND', 'COMPANY', 'TRACE', 'BATCH', 'DATE', 'EFFECTIVE', 'SETTLEMENT',
  'ONLINE', 'ELECTRONIC', 'AUTH', 'PURCHASE', 'THE', 'LLC', 'INC', 'CORP', 'LTD',
  // PDF statements spell the ACH fields out in full ("Orig CO Name:… Descr:…"),
  // so the long forms have to be stripped as well or they end up in the name.
  'DESCR', 'DESCRIPTION', 'ORIGINATOR', 'RECURRING', 'PREAUTHORIZED', 'PPDID',
]);

/**
 * Reduce a bank descriptor to a stable merchant key so the same payee
 * groups together across rows: drop tokens containing digits, drop ACH
 * plumbing words, keep the first few real words.
 */
export function merchantKey(description: string): string {
  const norm = normalizeDescription(description).trim();
  const tokens = norm.split(' ').filter((t) => t && !/\d/.test(t) && !NOISE_TOKENS.has(t) && t.length > 1);
  if (!tokens.length) return norm.slice(0, 24);
  return tokens.slice(0, 4).join(' ');
}

/** Pretty display name from a raw descriptor when no funder matched. */
function prettyName(description: string): string {
  const norm = normalizeDescription(description).trim();
  const tokens = norm.split(' ').filter((t) => t && !/^\d+$/.test(t) && !NOISE_TOKENS.has(t));
  const pick = tokens.slice(0, 4).join(' ') || norm.slice(0, 28);
  return pick
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

const NSF_RE = /NSF|NON\s?SUFFICIENT|INSUFFICIENT\s?FUND|RETURNED?\s?(ITEM|CHECK|ACH|PAYMENT|DEPOSIT)|UNPAID\s?ITEM|CHARGEBACK/i;
const OD_FEE_RE = /OVERDRAFT\s?(FEE|CHARGE|ITEM)|\bOD\s?FEE\b|EXTENDED\s?OVERDRAFT|UNCOLLECTED\s?FUNDS\s?FEE/i;

/** Deposits that are not real revenue: transfers, refunds, advance proceeds. */
const NON_REVENUE_DEPOSIT_RE =
  /TRANSFER\s?FROM|ONLINE\s?TRANSFER|INTERNAL\s?TRANSFER|\bTRSF\b|BOOK\s?TRANSFER|REVERSAL|REFUND|RETURNED\s?ITEM|CREDIT\s?MEMO|LOAN\s?PROCEED|ADVANCE\s?FUND|FUNDING\s?PROCEED|DEPOSIT\s?REVERSAL|COUNTER\s?CREDIT/i;

function cadenceFromGap(gap: number): Cadence {
  if (gap <= 0) return 'irregular';
  if (gap <= 2.2) return 'daily';
  if (gap <= 4.5) return 'semi-weekly';
  if (gap <= 9.5) return 'weekly';
  if (gap <= 18) return 'bi-weekly';
  if (gap <= 40) return 'monthly';
  return 'irregular';
}

function perDay(cadence: Cadence, amount: number): number {
  switch (cadence) {
    case 'daily': return amount;
    case 'semi-weekly': return (amount * 2.5) / 5;
    case 'weekly': return amount / 5;
    case 'bi-weekly': return amount / 10;
    case 'monthly': return amount / BUSINESS_DAYS_PER_MONTH;
    default: return amount / BUSINESS_DAYS_PER_MONTH;
  }
}

function perMonth(cadence: Cadence, amount: number): number {
  switch (cadence) {
    case 'daily': return amount * BUSINESS_DAYS_PER_MONTH;
    case 'semi-weekly': return amount * 2.5 * WEEKS_PER_MONTH;
    case 'weekly': return amount * WEEKS_PER_MONTH;
    case 'bi-weekly': return (amount * WEEKS_PER_MONTH) / 2;
    case 'monthly': return amount;
    default: return amount;
  }
}

export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'Daily',
  'semi-weekly': '2–3× per week',
  weekly: 'Weekly',
  'bi-weekly': 'Bi-weekly',
  monthly: 'Monthly',
  irregular: 'Irregular',
};

/* ────────────────────── position detection ────────────────────── */

interface Stream {
  key: string;
  descriptor: string;
  txns: Transaction[];
  amount: number;
  cadence: Cadence;
  medianGap: number;
}

/**
 * Find recurring fixed-amount debit streams. Descriptors are grouped by
 * merchant key, then each group is clustered by amount (±2%) so a payee
 * with one steady payment separates cleanly from ad-hoc charges.
 */
function findRecurringStreams(txns: Transaction[]): Stream[] {
  const debits = txns.filter((t) => t.amount < 0);
  const groups = new Map<string, Transaction[]>();
  for (const t of debits) {
    const k = merchantKey(t.description);
    if (!k) continue;
    const arr = groups.get(k);
    if (arr) arr.push(t); else groups.set(k, [t]);
  }

  const streams: Stream[] = [];
  for (const [key, rows] of groups) {
    if (rows.length < 3) continue;

    // Cluster the group by amount so one payee can hold more than one
    // distinct recurring stream (and so noise doesn't dilute the median).
    const byAmount = [...rows].sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
    const clusters: Transaction[][] = [];
    let current: Transaction[] = [];
    for (const t of byAmount) {
      if (!current.length) { current = [t]; continue; }
      const base = Math.abs(current[0].amount);
      if (Math.abs(Math.abs(t.amount) - base) <= Math.max(base * 0.02, 1)) current.push(t);
      else { clusters.push(current); current = [t]; }
    }
    if (current.length) clusters.push(current);

    for (const cluster of clusters) {
      if (cluster.length < 3) continue;
      const sorted = [...cluster].sort((a, b) => (a.date < b.date ? -1 : 1));
      const uniqueDates = Array.from(new Set(sorted.map((t) => t.date)));
      if (uniqueDates.length < 3) continue;

      const gaps: number[] = [];
      for (let i = 1; i < uniqueDates.length; i++) {
        const g = daysBetween(uniqueDates[i - 1], uniqueDates[i]);
        if (g > 0) gaps.push(g);
      }
      if (!gaps.length) continue;

      // Weekend-adjusted: a Friday→Monday gap of 3 is still a daily debit.
      const adjusted = gaps.map((g) => (g === 3 || g === 2 ? 1 : g));
      const medGap = median(adjusted);
      const cadence = cadenceFromGap(medGap);

      streams.push({
        key,
        descriptor: sorted[0].description,
        txns: sorted,
        amount: median(sorted.map((t) => Math.abs(t.amount))),
        cadence,
        medianGap: medGap,
      });
    }
  }
  return streams;
}

/**
 * Decide which recurring streams are merchant cash advances.
 *
 * A stream qualifies when EITHER:
 *   • the descriptor matches a known MCA funder, or
 *   • it debits daily / 2–3× weekly / weekly at a fixed amount at least
 *     four times, and it is not on the known non-advance list.
 */
function classifyPositions(
  streams: Stream[],
  periodEnd: string,
  avgMonthlyDeposits: number,
): McaPosition[] {
  const positions: McaPosition[] = [];

  for (const s of streams) {
    const known = matchKnownFunder(s.descriptor);
    const excluded = isNonMcaRecurring(s.descriptor);
    const weak = hasWeakMcaHint(s.descriptor);
    const mcaCadence = s.cadence === 'daily' || s.cadence === 'weekly' || s.cadence === 'semi-weekly';

    // A known funder counts even on an odd cadence; everything else needs
    // the classic daily/weekly fixed-debit shape.
    const qualifies = known
      ? !excluded
      : !excluded && mcaCadence && s.txns.length >= 4;
    if (!qualifies) continue;

    // Amount consistency — share of debits within 2% of the median.
    const consistent = s.txns.filter(
      (t) => Math.abs(Math.abs(t.amount) - s.amount) <= Math.max(s.amount * 0.02, 1),
    ).length / s.txns.length;
    if (!known && consistent < 0.7) continue;

    const reasons: string[] = [];
    let confidenceScore = 0;
    if (known) { confidenceScore += 55; reasons.push(`Descriptor matches ${known}, a known MCA funder`); }
    if (weak) { confidenceScore += 12; reasons.push('Descriptor contains advance/funding wording'); }
    if (s.cadence === 'daily') { confidenceScore += 25; reasons.push('Debits every business day'); }
    else if (s.cadence === 'weekly') { confidenceScore += 20; reasons.push('Debits once a week'); }
    else if (s.cadence === 'semi-weekly') { confidenceScore += 15; reasons.push('Debits 2–3 times a week'); }
    if (consistent >= 0.95) { confidenceScore += 15; reasons.push('Payment amount is identical every time'); }
    else if (consistent >= 0.8) { confidenceScore += 8; reasons.push('Payment amount is nearly identical every time'); }
    if (s.txns.length >= 15) { confidenceScore += 8; reasons.push(`${s.txns.length} debits observed`); }

    const confidence: McaPosition['confidence'] =
      confidenceScore >= 70 ? 'high' : confidenceScore >= 45 ? 'medium' : 'low';

    const firstDate = s.txns[0].date;
    const lastDate = s.txns[s.txns.length - 1].date;
    const dailyEquivalent = perDay(s.cadence, s.amount);
    const monthlyEquivalent = perMonth(s.cadence, s.amount);

    // Reverse-solve the original structure with the shared calculator.
    const freq = s.cadence === 'weekly' || s.cadence === 'bi-weekly' ? 'weekly' : 'daily';
    const solveAmount = s.cadence === 'semi-weekly' ? dailyEquivalent : s.amount;
    let candidate = null;
    try {
      candidate = reverseCalculate({
        payment: solveAmount,
        paymentFrequency: freq,
        deposit: avgMonthlyDeposits > 0 ? avgMonthlyDeposits : undefined,
      })[0] ?? null;
    } catch {
      candidate = null;
    }

    const totalDebited = s.txns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const daysSinceLast = daysBetween(lastDate, periodEnd);
    const likelyPaidOff = daysSinceLast > 21;

    let estimatedRemaining: number | null = null;
    let estimatedRemainingPct: number | null = null;
    const startedInPeriod = false; // resolved by the caller, which knows the window
    if (candidate && likelyPaidOff) {
      estimatedRemaining = 0;
      estimatedRemainingPct = 0;
    }

    positions.push({
      id: `${s.key}|${Math.round(s.amount * 100)}`,
      funderName: known ?? prettyName(s.descriptor),
      identified: Boolean(known),
      descriptor: s.descriptor,
      cadence: s.cadence,
      paymentAmount: s.amount,
      paymentCount: s.txns.length,
      firstDate,
      lastDate,
      dailyEquivalent,
      monthlyEquivalent,
      totalDebited,
      confidence,
      confidenceReasons: reasons,
      estimatedFunding: candidate ? candidate.fundingAmount : null,
      estimatedFactor: candidate ? candidate.factorRate : null,
      estimatedTermWeeks: candidate ? candidate.termWeeks : null,
      estimatedPayback: candidate ? candidate.totalPayback : null,
      startedInPeriod,
      estimatedRemaining,
      estimatedRemainingPct,
      likelyPaidOff,
    });
  }

  // Biggest burden first.
  positions.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
  return positions;
}

/* ────────────────────── monthly metrics ────────────────────── */

function buildMonths(
  txns: Transaction[],
  mcaTxnKeys: Set<string>,
  periodStart: string,
  periodEnd: string,
): { months: MonthStat[]; balancesAvailable: boolean } {
  const withBalance = txns.filter((t) => t.balance !== null).length;
  const balancesAvailable = txns.length > 0 && withBalance >= txns.length * 0.6;

  const byMonth = new Map<string, Transaction[]>();
  for (const t of txns) {
    const key = t.date.slice(0, 7);
    const arr = byMonth.get(key);
    if (arr) arr.push(t); else byMonth.set(key, [t]);
  }

  const months: MonthStat[] = [];
  for (const key of Array.from(byMonth.keys()).sort()) {
    const rows = byMonth.get(key)!;
    let deposits = 0, depositCount = 0, trueRevenue = 0, withdrawals = 0;
    let nsfCount = 0, mcaDebits = 0, largestDeposit = 0;

    for (const t of rows) {
      if (t.amount > 0) {
        deposits += t.amount;
        depositCount++;
        if (t.amount > largestDeposit) largestDeposit = t.amount;
        const isAdvanceIn = Boolean(matchKnownFunder(t.description)) || NON_REVENUE_DEPOSIT_RE.test(t.description);
        if (!isAdvanceIn) trueRevenue += t.amount;
      } else if (t.amount < 0) {
        withdrawals += Math.abs(t.amount);
        if (mcaTxnKeys.has(`${t.date}|${t.description}|${t.amount.toFixed(2)}`)) mcaDebits += Math.abs(t.amount);
      }
      if (NSF_RE.test(t.description) || OD_FEE_RE.test(t.description)) nsfCount++;
    }

    // End-of-day balance series → negative days, min, average.
    let negativeDays = 0;
    let minBalance: number | null = null;
    let avgDailyBalance: number | null = null;
    let endingBalance: number | null = null;

    if (balancesAvailable) {
      const dayEnd = new Map<string, number>();
      for (const t of rows) {
        if (t.balance === null) continue;
        dayEnd.set(t.date, t.balance); // rows are date-sorted, last wins
      }
      const days = Array.from(dayEnd.keys()).sort();
      if (days.length) {
        const values = days.map((d) => dayEnd.get(d)!);
        negativeDays = values.filter((v) => v < 0).length;
        minBalance = Math.min(...values);
        endingBalance = values[values.length - 1];
        // Carry each day's closing balance forward across days with no
        // activity so the average reflects the whole month.
        const first = Date.parse(`${days[0]}T00:00:00Z`);
        const last = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
        const span = Math.max(1, Math.round((last - first) / 86400000) + 1);
        let running = values[0];
        let total = 0;
        for (let i = 0; i < span; i++) {
          const iso = new Date(first + i * 86400000).toISOString().slice(0, 10);
          if (dayEnd.has(iso)) running = dayEnd.get(iso)!;
          total += running;
        }
        avgDailyBalance = total / span;
      }
    }

    // How much of this calendar month the statements actually span.
    const [yy, mm] = key.split('-').map(Number);
    const monthFirst = `${key}-01`;
    const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const monthLast = `${key}-${lastDay < 10 ? '0' : ''}${lastDay}`;
    const from = monthFirst > periodStart ? monthFirst : periodStart;
    const to = monthLast < periodEnd ? monthLast : periodEnd;
    const daysCovered = Math.max(1, daysBetween(from, to) + 1);

    months.push({
      key,
      label: monthLabel(key),
      daysCovered,
      partial: daysCovered < 20,
      deposits,
      depositCount,
      trueRevenue,
      withdrawals,
      net: deposits - withdrawals,
      mcaDebits,
      nsfCount,
      negativeDays,
      minBalance,
      avgDailyBalance,
      endingBalance,
      largestDeposit,
      concentrationPct: deposits > 0 ? largestDeposit / deposits : 0,
    });
  }

  return { months, balancesAvailable };
}

/* ────────────────────── the main entry point ────────────────────── */

export function analyzeStatements(input: Transaction[], parseWarnings: string[] = []): UnderwritingReport {
  const txns = [...input].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const empty: UnderwritingReport = {
    hasData: false,
    transactionCount: 0,
    periodStart: '', periodEnd: '', monthsCovered: 0, balancesAvailable: false,
    months: [], avgMonthlyDeposits: 0, avgMonthlyRevenue: 0, avgMonthlyWithdrawals: 0,
    avgMonthlyNet: 0, avgDepositCount: 0, avgDailyBalance: null, lowestBalance: null,
    totalNsf: 0, totalNegativeDays: 0,
    positions: [], positionCount: 0, totalDailyMca: 0, totalMonthlyMca: 0,
    totalEstimatedPayback: 0, holdbackPct: 0, advanceDepositsFound: [],
    score: 0, grade: 'Decline', verdict: 'No data', verdictDetail: '',
    positives: [], redFlags: [], checks: [], maxNewAdvance: 0, maxNewAdvanceBasis: '',
    recentMcaTransactions: [], warnings: parseWarnings,
  };
  if (!txns.length) return empty;

  const periodStart = txns[0].date;
  const periodEnd = txns[txns.length - 1].date;

  // First pass at deposits so the reverse-solver has a sanity anchor.
  const monthKeys = Array.from(new Set(txns.map((t) => t.date.slice(0, 7))));
  const monthBuckets = Math.max(1, monthKeys.length);
  const grossDeposits = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const roughMonthlyDeposits = grossDeposits / monthBuckets;

  // Positions.
  const streams = findRecurringStreams(txns);
  const positions = classifyPositions(streams, periodEnd, roughMonthlyDeposits);

  // Map every transaction that belongs to a detected position.
  const mcaTxnKeys = new Set<string>();
  const mcaKeySet = new Set(positions.map((p) => p.id));
  for (const s of streams) {
    const id = `${s.key}|${Math.round(s.amount * 100)}`;
    if (!mcaKeySet.has(id)) continue;
    for (const t of s.txns) mcaTxnKeys.add(`${t.date}|${t.description}|${t.amount.toFixed(2)}`);
  }

  // Advances that FUNDED during the statement window — a deposit from a
  // known funder. These both explain a spike in deposits and pin down when
  // a position started.
  const advanceDepositsFound = txns
    .filter((t) => t.amount > 0 && Boolean(matchKnownFunder(t.description)) && t.amount >= 2000)
    .map((t) => ({ date: t.date, description: t.description, amount: t.amount }));

  // Resolve "started in period" + remaining balance where determinable.
  for (const p of positions) {
    const gapFromStart = daysBetween(periodStart, p.firstDate);
    const fundingDeposit = advanceDepositsFound.find(
      (d) => matchKnownFunder(d.description) === p.funderName && daysBetween(d.date, p.firstDate) >= -3 && daysBetween(d.date, p.firstDate) <= 21,
    );
    const started = Boolean(fundingDeposit) || (gapFromStart >= 10 && p.cadence === 'daily') || (gapFromStart >= 21 && p.cadence !== 'daily');
    p.startedInPeriod = started;

    if (p.likelyPaidOff) {
      p.estimatedRemaining = 0;
      p.estimatedRemainingPct = 0;
    } else if (started && p.estimatedPayback) {
      const paid = p.totalDebited;
      const remaining = Math.max(0, p.estimatedPayback - paid);
      p.estimatedRemaining = remaining;
      p.estimatedRemainingPct = p.estimatedPayback > 0 ? remaining / p.estimatedPayback : null;
    } else {
      // Start predates the statements — remaining is genuinely unknown and
      // we do not invent a number for it.
      p.estimatedRemaining = null;
      p.estimatedRemainingPct = null;
    }
    if (fundingDeposit && fundingDeposit.amount >= 2000) {
      // A real funding deposit beats the reverse-solved guess.
      p.estimatedFunding = fundingDeposit.amount;
      p.confidenceReasons.push(`A ${fmt(fundingDeposit.amount)} deposit from this funder landed ${fundingDeposit.date}`);
      p.confidence = 'high';
      if (p.estimatedFactor) {
        p.estimatedPayback = fundingDeposit.amount * p.estimatedFactor;
        const remaining = Math.max(0, p.estimatedPayback - p.totalDebited);
        p.estimatedRemaining = p.likelyPaidOff ? 0 : remaining;
        p.estimatedRemainingPct = p.estimatedPayback > 0 ? (p.estimatedRemaining ?? 0) / p.estimatedPayback : null;
      }
    }
  }

  // Monthly metrics.
  const { months, balancesAvailable } = buildMonths(txns, mcaTxnKeys, periodStart, periodEnd);

  // Statement windows rarely line up with calendar months, so the first
  // and last buckets are usually stubs. Averaging a 3-day stub in as a
  // whole month drags every per-month figure down — so the averages run
  // over the full buckets only, falling back to everything if there are
  // none (a single partial month uploaded on its own).
  const fullMonths = months.filter((m) => !m.partial);
  const basis = fullMonths.length ? fullMonths : months;

  const avgMonthlyDeposits = basis.reduce((s, m) => s + m.deposits, 0) / basis.length;
  const avgMonthlyRevenue = basis.reduce((s, m) => s + m.trueRevenue, 0) / basis.length;
  const avgMonthlyWithdrawals = basis.reduce((s, m) => s + m.withdrawals, 0) / basis.length;
  const avgMonthlyNet = avgMonthlyDeposits - avgMonthlyWithdrawals;
  const avgDepositCount = basis.reduce((s, m) => s + m.depositCount, 0) / basis.length;

  // Balance averages weight by days covered so a stub bucket can't swing
  // the number as hard as a full month.
  const balMonths = basis.filter((m) => m.avgDailyBalance !== null);
  const balDays = balMonths.reduce((s, m) => s + m.daysCovered, 0);
  const avgDailyBalance = balMonths.length && balDays > 0
    ? balMonths.reduce((s, m) => s + (m.avgDailyBalance ?? 0) * m.daysCovered, 0) / balDays
    : null;
  const minMonths = months.filter((m) => m.minBalance !== null);
  const lowestBalance = minMonths.length ? Math.min(...minMonths.map((m) => m.minBalance ?? 0)) : null;

  const totalNsf = months.reduce((s, m) => s + m.nsfCount, 0);
  const totalNegativeDays = months.reduce((s, m) => s + m.negativeDays, 0);

  // Only positions that are still being debited count toward the burden.
  const live = positions.filter((p) => !p.likelyPaidOff);
  const totalDailyMca = live.reduce((s, p) => s + p.dailyEquivalent, 0);
  const totalMonthlyMca = live.reduce((s, p) => s + p.monthlyEquivalent, 0);
  const totalEstimatedPayback = live.reduce((s, p) => s + (p.estimatedPayback ?? 0), 0);
  const holdbackPct = avgMonthlyDeposits > 0 ? totalMonthlyMca / avgMonthlyDeposits : 0;

  const recentMcaTransactions = txns
    .filter((t) => mcaTxnKeys.has(`${t.date}|${t.description}|${t.amount.toFixed(2)}`))
    .slice(-40)
    .reverse()
    .map((t) => ({ date: t.date, description: t.description, amount: t.amount }));

  /* ── scoring ── */
  // Rates are per 30.44 days of ACTUAL statement coverage, not per calendar
  // bucket — otherwise a one-day stub bucket counts as a whole clean month
  // and dilutes the NSF and negative-day rates.
  const coveredDays = Math.max(1, daysBetween(periodStart, periodEnd) + 1);
  const rateMonths = Math.max(1, coveredDays / 30.44);
  // Whole months of coverage, for the "did they send 3 statements?" check.
  const monthsCovered = Math.max(1, Math.round(coveredDays / 30.44));
  const nsfPerMonth = totalNsf / rateMonths;
  const negDaysPerMonth = totalNegativeDays / rateMonths;
  const positionCount = live.length;

  let score = 100;
  const redFlags: RedFlag[] = [];
  const positives: string[] = [];

  if (avgMonthlyRevenue < 10_000) { score -= 30; redFlags.push({ severity: 'critical', label: 'Revenue below most funder minimums', detail: `${fmt(avgMonthlyRevenue)}/month in true revenue. Most funders want $15,000+.` }); }
  else if (avgMonthlyRevenue < 15_000) { score -= 15; redFlags.push({ severity: 'warning', label: 'Thin monthly revenue', detail: `${fmt(avgMonthlyRevenue)}/month. Under the $15,000 minimum at many shops.` }); }
  else if (avgMonthlyRevenue >= 50_000) positives.push(`Strong revenue — ${fmt(avgMonthlyRevenue)} per month`);
  else positives.push(`Revenue clears the typical minimum — ${fmt(avgMonthlyRevenue)} per month`);

  if (avgDepositCount < 5) { score -= 15; redFlags.push({ severity: 'warning', label: 'Too few deposits', detail: `${avgDepositCount.toFixed(1)} deposits per month. Most funders want 5–10+ as proof of steady sales.` }); }
  else if (avgDepositCount >= 10) positives.push(`${Math.round(avgDepositCount)} deposits per month — steady sales volume`);

  if (negDaysPerMonth > 6) { score -= 25; redFlags.push({ severity: 'critical', label: 'Frequent negative days', detail: `${negDaysPerMonth.toFixed(1)} negative days per month. Most funders cap this at 3–5.` }); }
  else if (negDaysPerMonth > 3) { score -= 12; redFlags.push({ severity: 'warning', label: 'Negative days present', detail: `${negDaysPerMonth.toFixed(1)} negative days per month — above the usual 3-day comfort line.` }); }
  else if (balancesAvailable && negDaysPerMonth === 0) positives.push('No negative days across the statements');

  if (nsfPerMonth > 5) { score -= 20; redFlags.push({ severity: 'critical', label: 'Heavy NSF activity', detail: `${nsfPerMonth.toFixed(1)} NSF / overdraft items per month.` }); }
  else if (nsfPerMonth > 2) { score -= 10; redFlags.push({ severity: 'warning', label: 'NSF activity', detail: `${nsfPerMonth.toFixed(1)} NSF / overdraft items per month.` }); }
  else if (totalNsf === 0) positives.push('No NSF or overdraft items found');

  if (positionCount >= 4) { score -= 25; redFlags.push({ severity: 'critical', label: `${positionCount} open positions`, detail: 'Four or more advances stacked. Most funders will not add a position here.' }); }
  else if (positionCount === 3) { score -= 12; redFlags.push({ severity: 'warning', label: '3 open positions', detail: 'A 4th-position deal — limited funder appetite.' }); }
  else if (positionCount === 0) positives.push('No existing advances detected — a clean 1st position');
  else positives.push(`${positionCount} existing position${positionCount === 1 ? '' : 's'} detected`);

  if (holdbackPct > 0.30) { score -= 25; redFlags.push({ severity: 'critical', label: 'Over-leveraged', detail: `Existing advances take ${(holdbackPct * 100).toFixed(1)}% of deposits. Above 30% almost always kills a new advance.` }); }
  else if (holdbackPct > 0.20) { score -= 12; redFlags.push({ severity: 'warning', label: 'High existing holdback', detail: `Existing advances take ${(holdbackPct * 100).toFixed(1)}% of deposits.` }); }
  else if (positionCount > 0) positives.push(`Existing advances take only ${(holdbackPct * 100).toFixed(1)}% of deposits`);

  const worstConcentration = Math.max(0, ...months.map((m) => m.concentrationPct));
  if (worstConcentration > 0.5 && avgDepositCount < 10) {
    score -= 8;
    redFlags.push({ severity: 'warning', label: 'Deposit concentration', detail: `One deposit made up ${(worstConcentration * 100).toFixed(0)}% of a month's total — revenue leans on a single payer.` });
  }

  if (balancesAvailable && avgDailyBalance !== null) {
    if (avgDailyBalance < 1000) { score -= 12; redFlags.push({ severity: 'warning', label: 'Low average daily balance', detail: `${fmt(avgDailyBalance)} average. Funders read this as no cushion.` }); }
    else if (avgDailyBalance >= 10_000) positives.push(`Healthy average daily balance — ${fmt(avgDailyBalance)}`);
  }

  if (monthsCovered < 3) {
    redFlags.push({ severity: 'info', label: 'Short statement window', detail: `Only ${monthsCovered} month${monthsCovered === 1 ? '' : 's'} of data. Funders want 3–6 months; the read below is less reliable.` });
  }

  if (advanceDepositsFound.length) {
    redFlags.push({
      severity: 'info',
      label: 'Advance funded during this period',
      detail: `${advanceDepositsFound.length} deposit${advanceDepositsFound.length === 1 ? '' : 's'} from a known funder landed inside the statement window — those are not revenue.`,
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade: Grade =
    score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'Decline';

  const VERDICT: Record<Grade, { v: string; d: string }> = {
    A: { v: 'STRONG FILE', d: 'Clean bank behavior with room for a new advance. This should shop well at A/B paper.' },
    B: { v: 'FUNDABLE', d: 'Solid file with a few soft spots. Expect standard B-paper terms.' },
    C: { v: 'WORKABLE', d: 'Real issues in the file. C/D paper funders, shorter terms, smaller dollars.' },
    D: { v: 'DIFFICULT', d: 'Heavy stacking, NSFs, or thin revenue. Only the most aggressive funders will look at it.' },
    Decline: { v: 'LIKELY DECLINE', d: 'The file fails multiple standard boxes. Fix the underlying issues before shopping it.' },
  };

  /* ── room for a new advance ── */
  const maxHoldback = grade === 'A' ? 0.22 : grade === 'B' ? 0.19 : grade === 'C' ? 0.15 : 0.12;
  const capacityMonthly = avgMonthlyRevenue * maxHoldback - totalMonthlyMca;
  let maxNewAdvance = 0;
  if (capacityMonthly > 0) {
    // Six months of payment capacity, discounted by a 1.35 factor.
    const paybackCapacity = capacityMonthly * 6;
    maxNewAdvance = Math.max(0, Math.round((paybackCapacity / 1.35) / 1000) * 1000);
  }
  const maxNewAdvanceBasis = capacityMonthly > 0
    ? `${(maxHoldback * 100).toFixed(0)}% of ${fmt(avgMonthlyRevenue)} monthly revenue less ${fmt(totalMonthlyMca)} of existing payments, over a 6-month term at a 1.35 factor.`
    : `Existing advances already consume ${fmt(totalMonthlyMca)} per month, at or above the ${(maxHoldback * 100).toFixed(0)}% holdback this file supports. There is no room for new money without a consolidation or a payoff.`;

  /* ── the scrub checklist ── */
  const checks: ScrubCheck[] = [
    {
      label: 'Average monthly revenue',
      status: avgMonthlyRevenue >= 25_000 ? 'pass' : avgMonthlyRevenue >= 15_000 ? 'warn' : 'fail',
      value: fmt(avgMonthlyRevenue),
      benchmark: '$15,000+ minimum',
    },
    {
      label: 'Deposits per month',
      status: avgDepositCount >= 10 ? 'pass' : avgDepositCount >= 5 ? 'warn' : 'fail',
      value: avgDepositCount.toFixed(1),
      benchmark: '5–10+ expected',
    },
    {
      label: 'Negative days per month',
      status: !balancesAvailable ? 'unknown' : negDaysPerMonth <= 1 ? 'pass' : negDaysPerMonth <= 3 ? 'warn' : 'fail',
      value: balancesAvailable ? negDaysPerMonth.toFixed(1) : 'No balance column',
      benchmark: '3 or fewer',
    },
    {
      label: 'NSF / overdraft items per month',
      status: nsfPerMonth <= 1 ? 'pass' : nsfPerMonth <= 3 ? 'warn' : 'fail',
      value: nsfPerMonth.toFixed(1),
      benchmark: '3 or fewer',
    },
    {
      label: 'Open MCA positions',
      status: positionCount <= 1 ? 'pass' : positionCount <= 3 ? 'warn' : 'fail',
      value: String(positionCount),
      benchmark: '3 or fewer for most funders',
    },
    {
      label: 'Existing holdback',
      status: holdbackPct <= 0.15 ? 'pass' : holdbackPct <= 0.25 ? 'warn' : 'fail',
      value: `${(holdbackPct * 100).toFixed(1)}%`,
      benchmark: 'Under 25% of deposits',
    },
    {
      label: 'Average daily balance',
      status: !balancesAvailable || avgDailyBalance === null ? 'unknown' : avgDailyBalance >= 5000 ? 'pass' : avgDailyBalance >= 1000 ? 'warn' : 'fail',
      value: avgDailyBalance === null ? 'No balance column' : fmt(avgDailyBalance),
      benchmark: '$1,000+ cushion',
    },
    {
      label: 'Statement months provided',
      status: monthsCovered >= 3 ? 'pass' : monthsCovered === 2 ? 'warn' : 'fail',
      value: String(monthsCovered),
      benchmark: '3–6 months',
    },
  ];

  return {
    hasData: true,
    transactionCount: txns.length,
    periodStart,
    periodEnd,
    monthsCovered,
    balancesAvailable,
    months,
    avgMonthlyDeposits,
    avgMonthlyRevenue,
    avgMonthlyWithdrawals,
    avgMonthlyNet,
    avgDepositCount,
    avgDailyBalance,
    lowestBalance,
    totalNsf,
    totalNegativeDays,
    positions,
    positionCount,
    totalDailyMca,
    totalMonthlyMca,
    totalEstimatedPayback,
    holdbackPct,
    advanceDepositsFound,
    score,
    grade,
    verdict: VERDICT[grade].v,
    verdictDetail: VERDICT[grade].d,
    positives,
    redFlags,
    checks,
    maxNewAdvance,
    maxNewAdvanceBasis,
    recentMcaTransactions,
    warnings: parseWarnings,
  };
}

/* ────────────────────── formatting + export ────────────────────── */

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtMoneyShort(n: number): string {
  return fmt(n);
}

export function fmtStatementDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!y || !m || !d) return iso;
  return `${names[m - 1]} ${d}, ${y}`;
}

/**
 * Plain-text summary for pasting into an email to a funder or into the
 * deal notes. Mirrors the on-screen report exactly.
 */
export function reportToText(r: UnderwritingReport, merchantName?: string): string {
  if (!r.hasData) return 'No transactions were parsed.';
  const L: string[] = [];
  const title = merchantName ? `UNDERWRITING SCRUB — ${merchantName.toUpperCase()}` : 'UNDERWRITING SCRUB';
  L.push(title);
  L.push(`Statements: ${fmtStatementDate(r.periodStart)} – ${fmtStatementDate(r.periodEnd)} (${r.monthsCovered} month${r.monthsCovered === 1 ? '' : 's'}, ${r.transactionCount} transactions)`);
  L.push('');
  L.push(`RESULT: ${r.verdict} — Grade ${r.grade} (${r.score}/100)`);
  L.push(r.verdictDetail);
  L.push('');
  L.push('CASH FLOW');
  L.push(`  Avg monthly deposits ....... ${fmt(r.avgMonthlyDeposits)}`);
  L.push(`  Avg monthly true revenue ... ${fmt(r.avgMonthlyRevenue)}`);
  L.push(`  Avg deposits per month ..... ${r.avgDepositCount.toFixed(1)}`);
  if (r.avgDailyBalance !== null) L.push(`  Avg daily balance .......... ${fmt(r.avgDailyBalance)}`);
  if (r.lowestBalance !== null) L.push(`  Lowest balance ............. ${fmt(r.lowestBalance)}`);
  L.push(`  NSF / overdraft items ...... ${r.totalNsf}`);
  if (r.balancesAvailable) L.push(`  Negative days .............. ${r.totalNegativeDays}`);
  L.push('');

  L.push(`POSITIONS (${r.positionCount} open)`);
  if (!r.positions.length) {
    L.push('  None detected — no recurring daily or weekly advance debits found.');
  } else {
    for (const p of r.positions) {
      const structure = p.estimatedFunding
        ? ` | est. original ${fmt(p.estimatedFunding)}${p.estimatedFactor ? ` @ ${p.estimatedFactor.toFixed(2)}` : ''}`
        : '';
      L.push(`  • ${p.funderName} — ${fmtMoney(p.paymentAmount)} ${CADENCE_LABEL[p.cadence].toLowerCase()} (${fmt(p.monthlyEquivalent)}/mo)${structure}`);
      L.push(`      ${p.paymentCount} debits ${fmtStatementDate(p.firstDate)} – ${fmtStatementDate(p.lastDate)} | confidence: ${p.confidence}${p.likelyPaidOff ? ' | appears paid off / stopped' : ''}`);
      if (p.estimatedRemaining !== null && !p.likelyPaidOff) L.push(`      est. balance remaining ${fmt(p.estimatedRemaining)}`);
    }
    L.push(`  Total: ${fmtMoney(r.totalDailyMca)}/day, ${fmt(r.totalMonthlyMca)}/month — ${(r.holdbackPct * 100).toFixed(1)}% of deposits`);
  }
  L.push('');

  if (r.redFlags.length) {
    L.push('RED FLAGS');
    for (const f of r.redFlags) L.push(`  [${f.severity.toUpperCase()}] ${f.label} — ${f.detail}`);
    L.push('');
  }
  if (r.positives.length) {
    L.push('STRENGTHS');
    for (const p of r.positives) L.push(`  + ${p}`);
    L.push('');
  }

  L.push('MONTH BY MONTH');
  for (const m of r.months) {
    L.push(`  ${m.label}: deposits ${fmt(m.deposits)} (${m.depositCount}) | withdrawals ${fmt(m.withdrawals)} | NSF ${m.nsfCount}${m.avgDailyBalance !== null ? ` | avg bal ${fmt(m.avgDailyBalance)}` : ''}${r.balancesAvailable ? ` | neg days ${m.negativeDays}` : ''}`);
  }
  L.push('');
  L.push(`ROOM FOR NEW MONEY: ${fmt(r.maxNewAdvance)}`);
  L.push(`  ${r.maxNewAdvanceBasis}`);
  L.push('');
  L.push('Generated locally from the uploaded statements — pattern-based estimates, not a credit decision.');
  return L.join('\n');
}
