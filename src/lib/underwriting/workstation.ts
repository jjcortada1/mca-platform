/**
 * The underwriting workstation model.
 *
 * ───────────────────────────────────────────────────────────────────────
 * DETERMINISTIC. No AI, no LLM, no external API. Every number here comes
 * from arithmetic over the parsed transactions plus the rule tables in
 * ./dictionaries.ts and ./funders.ts.
 * ───────────────────────────────────────────────────────────────────────
 *
 * This layer sits on top of ./engine.ts (which already does MCA position
 * detection well) and adds what an underwriter actually needs:
 *
 *   • Gross Revenue vs True Revenue, with an itemized exclusion ledger
 *   • Per-transaction classification carrying a REASON and a CONFIDENCE
 *   • Manual overrides that re-drive every downstream number
 *   • Negative days computed from daily ENDING balances
 *   • NSF / overdraft / returned-ACH counted separately and de-duplicated
 *   • MCA withhold % with the arithmetic shown
 *   • Current vs historical positions, stop-payment and default detection
 *   • Debt-collection detection
 *   • Multiple bank accounts, including cross-account transfer netting
 *
 * Design rule: nothing is a black box. Every metric carries the inputs it
 * was computed from so the UI can answer "how did you get this?".
 */

import type { Transaction } from './parse';
import {
  findRecurringStreams, classifyPositions, median, daysBetween, monthLabel,
  CADENCE_LABEL, BUSINESS_DAYS_PER_MONTH, WEEKS_PER_MONTH,
} from './engine';
import type { McaPosition, Cadence } from './engine';
import { matchKnownFunder, hasWeakMcaHint } from './funders';
import {
  matchRevenueProcessor, matchNonRevenue, matchBankEvent, matchCollection,
  isFeeLine, toConfidence, NON_REVENUE_KIND_LABEL,
} from './dictionaries';
import type { NonRevenueKind, BankEventKind, ConfidenceLevel } from './dictionaries';

/* ═══════════════════════════ types ═══════════════════════════ */

export type TxnClass =
  | 'revenue'
  | 'non_revenue'
  | 'mca_payment'
  | 'mca_funding'
  | 'collection'
  | 'bank_event'
  | 'withdrawal'
  | 'ignored';

export const TXN_CLASS_LABEL: Record<TxnClass, string> = {
  revenue: 'Revenue',
  non_revenue: 'Non-revenue',
  mca_payment: 'MCA payment',
  mca_funding: 'MCA funding',
  collection: 'Collection',
  bank_event: 'NSF / return',
  withdrawal: 'Withdrawal',
  ignored: 'Ignored',
};

/** What the user can force a transaction to be, overriding the rules. */
export type OverrideClass = TxnClass;

export interface TxnOverride {
  /** Stable transaction key. */
  key: string;
  cls: OverrideClass;
}

export interface UwTransaction {
  /** Stable identity — date + description + amount + account. */
  key: string;
  date: string;
  description: string;
  /** Descriptor reduced to a payee name, for grouping and display. */
  merchant: string;
  amount: number;
  balance: number | null;
  accountId: string;
  statementId: string;
  month: string;          // YYYY-MM
  /** Effective classification (override wins over the rule engine). */
  cls: TxnClass;
  /** What the rules decided, before any override. */
  autoClass: TxnClass;
  /** True when a human changed it. */
  overridden: boolean;
  /** Counts toward True Revenue. Only meaningful for credits. */
  isTrueRevenue: boolean;
  /** Why it was classified this way — always populated. */
  reason: string;
  confidence: ConfidenceLevel;
  /** 0–1 weight behind `confidence`. */
  weight: number;
  /** Sub-kind for non-revenue credits. */
  nonRevenueKind: NonRevenueKind | null;
  /** Sub-kind for bank events. */
  bankEventKind: BankEventKind | null;
  /** Set when the row pays a detected position. */
  positionId: string | null;
  funderName: string | null;
  /** Unusually large for this account. */
  isLarge: boolean;
  /** Matched to an opposite entry in another uploaded account. */
  internalTransferPartner: string | null;
}

export interface UwAccount {
  id: string;
  /** Bank name if we could read one. */
  bank: string;
  /** Masked account number if we could read one. */
  mask: string;
  label: string;
  statementIds: string[];
  transactionCount: number;
}

export interface UwStatement {
  id: string;
  fileName: string;
  accountId: string;
  /** Months this statement covers. */
  months: string[];
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
  pageCount: number | null;
}

export interface RevenueSource {
  /** Normalized payee. */
  merchant: string;
  label: string;
  total: number;
  count: number;
  autoClass: TxnClass;
  classification: string;
  isTrueRevenue: boolean;
  /** True when any transaction in the group was manually overridden. */
  overridden: boolean;
  confidence: ConfidenceLevel;
  reason: string;
  keys: string[];
}

export interface MonthRow {
  key: string;
  label: string;
  daysCovered: number;
  partial: boolean;
  grossDeposits: number;
  trueRevenue: number;
  withdrawals: number;
  depositCount: number;
  avgDepositSize: number;
  largestDeposit: number;
  avgDailyBalance: number | null;
  lowBalance: number | null;
  highBalance: number | null;
  endingBalance: number | null;
  negativeDays: number;
  nsfCount: number;
  overdraftCount: number;
  returnedCount: number;
  mcaPayments: number;
  mcaWithholdPct: number;
}

export interface NegativeDayDetail {
  totalNegativeDays: number;
  perMonth: { month: string; label: string; days: number }[];
  longestRun: number;
  longestRunStart: string | null;
  longestRunEnd: string | null;
  lowestBalance: number | null;
  averageNegativeBalance: number | null;
  dates: { date: string; balance: number }[];
}

export type RiskSeverity = 'high' | 'medium' | 'low' | 'info';

export interface RiskFlag {
  id: string;
  severity: RiskSeverity;
  title: string;
  /** Plain-language explanation of WHY the rule fired. */
  explanation: string;
  confidence: ConfidenceLevel;
  /** Transactions that triggered it, so the UI can show the evidence. */
  txnKeys: string[];
}

export interface CollectionActivity {
  id: string;
  payee: string;
  total: number;
  count: number;
  confidence: ConfidenceLevel;
  reason: string;
  txnKeys: string[];
}

export interface FundingEventDetail {
  id: string;
  date: string;
  description: string;
  amount: number;
  funderName: string | null;
  confidence: ConfidenceLevel;
  reason: string;
  /** Position whose payments started right after this deposit. */
  linkedPositionId: string | null;
  linkedNote: string | null;
  txnKey: string;
}

export type PositionStatus = 'active' | 'paid_off' | 'stopped' | 'possible_default';

export const POSITION_STATUS_LABEL: Record<PositionStatus, string> = {
  active: 'Active',
  paid_off: 'Possible paid-off position',
  stopped: 'Payments stopped — needs review',
  possible_default: 'Possible default',
};

export interface UwPosition extends McaPosition {
  status: PositionStatus;
  statusReason: string;
  /** Months of the statement window this position was present in. */
  monthsPresent: number;
  monthsInPeriod: number;
  presentThroughout: boolean;
  weeklyEquivalent: number;
  /** Share of True Revenue this one position consumes. */
  withholdPct: number;
  confidenceLevel: ConfidenceLevel;
  fundingEventId: string | null;
  txnKeys: string[];
  /** Set by the underwriter; null = not reviewed. */
  userConfirmed: boolean | null;
}

export interface RevenueBridge {
  gross: number;
  exclusions: { kind: string; label: string; amount: number; count: number }[];
  trueRevenue: number;
}

export interface WithholdAudit {
  trueRevenueMonthly: number;
  positions: { name: string; monthly: number }[];
  totalMonthly: number;
  pct: number;
}

export interface UnderwritingFile {
  hasData: boolean;
  businessName: string;
  businessNameSource: 'detected' | 'manual' | 'unknown';
  periodStart: string;
  periodEnd: string;
  monthsCovered: number;
  statementCount: number;
  accountCount: number;
  generatedAt: string;

  accounts: UwAccount[];
  statements: UwStatement[];
  transactions: UwTransaction[];
  months: MonthRow[];

  // Snapshot metrics
  grossRevenueTotal: number;
  grossRevenueMonthly: number;
  trueRevenueTotal: number;
  trueRevenueMonthly: number;
  revenueBridge: RevenueBridge;
  avgDailyBalance: number | null;
  lowestBalance: number | null;
  highestBalance: number | null;
  avgMonthlyEndingBalance: number | null;
  avgMonthlyDeposits: number;
  avgDepositCount: number;
  totalWithdrawals: number;
  negativeDays: NegativeDayDetail;
  nsfCount: number;
  overdraftCount: number;
  returnedCount: number;

  positions: UwPosition[];
  currentPositions: UwPosition[];
  historicalPositions: UwPosition[];
  mcaMonthlyPayments: number;
  mcaWeeklyPayments: number;
  withhold: WithholdAudit;
  fundingEvents: FundingEventDetail[];
  collections: CollectionActivity[];
  riskFlags: RiskFlag[];
  revenueSources: RevenueSource[];

  // Trends
  revenueTrend: 'growing' | 'stable' | 'declining' | 'unknown';
  balanceTrend: 'growing' | 'stable' | 'declining' | 'unknown';
  revenueTrendPct: number;
  balancesAvailable: boolean;
  largeThreshold: number;
  warnings: string[];
}

/* ═══════════════════════ small helpers ═══════════════════════ */

const NOISE = new Set([
  'ACH', 'DEBIT', 'CREDIT', 'WEB', 'PMT', 'PAYMENT', 'PAYMENTS', 'CO', 'ENTRY',
  'DESC', 'DESCR', 'ID', 'ORIG', 'NAME', 'TRN', 'EFT', 'DDA', 'POS', 'PPD',
  'CCD', 'TEL', 'ARC', 'IAT', 'MEMO', 'REF', 'TYPE', 'SEC', 'IND', 'COMPANY',
  'TRACE', 'BATCH', 'DATE', 'EFFECTIVE', 'ONLINE', 'ELECTRONIC', 'AUTH',
  'THE', 'LLC', 'INC', 'CORP', 'LTD', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER',
]);

/** Reduce a bank descriptor to a display-ready payee name. */
export function normalizedMerchant(description: string): string {
  const norm = String(description || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const tokens = norm.split(' ').filter((t) => t && !/\d/.test(t) && !NOISE.has(t) && t.length > 1);
  const pick = tokens.slice(0, 4).join(' ') || norm.slice(0, 24) || 'Unknown';
  return pick.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function txnKey(t: Transaction, accountId: string): string {
  return `${accountId}|${t.date}|${t.amount.toFixed(2)}|${t.description.slice(0, 60)}`;
}

function pct(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/* ═════════════════ business name + account detection ═════════════════ */

const BANK_NAMES = [
  'CHASE', 'JPMORGAN', 'BANK OF AMERICA', 'WELLS FARGO', 'CITIBANK', 'CITI',
  'US BANK', 'U S BANK', 'PNC', 'TRUIST', 'TD BANK', 'CAPITAL ONE', 'REGIONS',
  'FIFTH THIRD', 'KEYBANK', 'HUNTINGTON', 'M T BANK', 'CITIZENS', 'BMO',
  'SANTANDER', 'FIRST CITIZENS', 'COMERICA', 'ZIONS', 'SYNOVUS', 'VALLEY NATIONAL',
  'NAVY FEDERAL', 'AMERICAN EXPRESS', 'MERCURY', 'NOVO', 'BLUEVINE', 'RELAY',
];

/**
 * Pull the bank, the masked account number, and the business name out of a
 * statement's opening lines.
 *
 * Statements put the bank name in the letterhead, the account number near
 * it, and the business name in the address block. This is a heuristic and
 * it says so — the UI lets the underwriter correct all three.
 */
export function detectStatementIdentity(text: string): {
  bank: string;
  mask: string;
  businessName: string;
} {
  const lines = String(text || '').split(/\r?\n/).slice(0, 40).map((l) => l.trim()).filter(Boolean);
  let bank = '';
  let mask = '';
  let businessName = '';

  for (const line of lines) {
    const up = line.toUpperCase();
    if (!bank) {
      for (const b of BANK_NAMES) {
        if (up.includes(b)) { bank = b.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' '); break; }
      }
    }
    if (!mask) {
      // "Account Number: 000000123456789", "••••1234", "XXXXXX7890"
      const m = up.match(/(?:ACCOUNT|ACCT)[^0-9A-Z]{0,12}(?:NUMBER|NO|#)?[^0-9]{0,6}([X•*\d\s-]{6,})/);
      if (m) {
        const digits = m[1].replace(/\D/g, '');
        if (digits.length >= 4) mask = digits.slice(-4);
      }
    }
  }

  // Business name: the first line that reads like a company and isn't the
  // bank's own letterhead or a label.
  for (const line of lines) {
    const up = line.toUpperCase();
    if (line.length < 3 || line.length > 60) continue;
    if (BANK_NAMES.some((b) => up.includes(b))) continue;
    if (/\d{3,}/.test(line)) continue;
    if (/(STATEMENT|ACCOUNT|PAGE|PERIOD|SUMMARY|BALANCE|CUSTOMER SERVICE|MEMBER FDIC|THROUGH|BEGINNING|ENDING)/.test(up)) continue;
    if (!/[A-Za-z]{3}/.test(line)) continue;
    // Company-ish: an entity suffix, or an all-caps line in the address block.
    if (/\b(LLC|L\.L\.C|INC|CORP|CO|COMPANY|LTD|LP|LLP|PLLC|GROUP|ENTERPRISES|SERVICES|SOLUTIONS|HOLDINGS|TRUCKING|LOGISTICS|CONSTRUCTION|RESTAURANT|AUTO|MEDICAL)\b/i.test(line)
        || (line === up && line.split(/\s+/).length >= 2)) {
      businessName = line.replace(/\s+/g, ' ').trim();
      break;
    }
  }

  return { bank, mask, businessName };
}

/* ═══════════════════ cross-account transfers ═══════════════════ */

/**
 * Match debits in one uploaded account against credits in another.
 *
 * If a merchant moves $25,000 from their operating account to their
 * savings account and both statements are uploaded, that $25,000 must not
 * count as revenue. Matching is same amount, opposite sign, different
 * account, within 3 days — tight enough that ordinary business activity
 * doesn't get swept up.
 */
function findInternalTransfers(
  rows: { key: string; date: string; amount: number; accountId: string }[],
): Map<string, string> {
  const partners = new Map<string, string>();
  const credits = rows.filter((r) => r.amount > 0);
  const debits = rows.filter((r) => r.amount < 0);
  const used = new Set<string>();

  for (const c of credits) {
    for (const d of debits) {
      if (used.has(d.key)) continue;
      if (d.accountId === c.accountId) continue;
      if (Math.abs(Math.abs(d.amount) - c.amount) > 0.01) continue;
      const gap = Math.abs(daysBetween(d.date, c.date));
      if (gap > 3) continue;
      partners.set(c.key, d.key);
      partners.set(d.key, c.key);
      used.add(d.key);
      used.add(c.key);
      break;
    }
  }
  return partners;
}

/* ═════════════════════════ the builder ═════════════════════════ */

export interface StatementInput {
  id: string;
  fileName: string;
  transactions: Transaction[];
  /** Raw extracted text, used for bank / business-name detection. */
  text?: string;
  pageCount?: number | null;
  /** Explicit account assignment; otherwise derived from the statement. */
  accountId?: string;
  accountLabel?: string;
}

export interface BuildOptions {
  overrides?: TxnOverride[];
  /** Underwriter-supplied business name wins over detection. */
  businessName?: string;
  /** Restrict the whole analysis to one account. */
  accountFilter?: string | null;
  /** Positions the underwriter confirmed or rejected. */
  positionDecisions?: Record<string, boolean>;
  warnings?: string[];
  /** Stamped into the file; passed in so the build stays pure. */
  generatedAt?: string;
}

export function buildUnderwritingFile(
  statements: StatementInput[],
  opts: BuildOptions = {},
): UnderwritingFile {
  const overrideMap = new Map((opts.overrides ?? []).map((o) => [o.key, o.cls]));
  const warnings = [...(opts.warnings ?? [])];

  /* ── Accounts + statements ── */
  const accounts = new Map<string, UwAccount>();
  const uwStatements: UwStatement[] = [];

  for (const st of statements) {
    const ident = st.text ? detectStatementIdentity(st.text) : { bank: '', mask: '', businessName: '' };
    const accountId = st.accountId
      ?? (ident.mask ? `${ident.bank || 'Account'}-${ident.mask}` : `file:${st.fileName}`);
    const label = st.accountLabel
      ?? (ident.mask ? `${ident.bank || 'Account'} ••••${ident.mask}` : st.fileName);

    let acct = accounts.get(accountId);
    if (!acct) {
      acct = { id: accountId, bank: ident.bank, mask: ident.mask, label, statementIds: [], transactionCount: 0 };
      accounts.set(accountId, acct);
    }
    acct.statementIds.push(st.id);
    acct.transactionCount += st.transactions.length;

    const dates = st.transactions.map((t) => t.date).sort();
    uwStatements.push({
      id: st.id,
      fileName: st.fileName,
      accountId,
      months: Array.from(new Set(st.transactions.map((t) => t.date.slice(0, 7)))).sort(),
      periodStart: dates[0] ?? '',
      periodEnd: dates[dates.length - 1] ?? '',
      transactionCount: st.transactions.length,
      pageCount: st.pageCount ?? null,
    });
  }

  /* ── Business name ── */
  let businessName = opts.businessName?.trim() ?? '';
  let businessNameSource: UnderwritingFile['businessNameSource'] = businessName ? 'manual' : 'unknown';
  if (!businessName) {
    for (const st of statements) {
      if (!st.text) continue;
      const d = detectStatementIdentity(st.text);
      if (d.businessName) { businessName = d.businessName; businessNameSource = 'detected'; break; }
    }
  }
  if (!businessName) businessName = 'Unnamed business';

  /* ── Flatten transactions, honoring the account filter ── */
  const stmtById = new Map(uwStatements.map((s) => [s.id, s]));
  const flat: { t: Transaction; key: string; accountId: string; statementId: string }[] = [];
  for (const st of statements) {
    const meta = stmtById.get(st.id)!;
    if (opts.accountFilter && meta.accountId !== opts.accountFilter) continue;
    for (const t of st.transactions) {
      flat.push({ t, key: txnKey(t, meta.accountId), accountId: meta.accountId, statementId: st.id });
    }
  }
  flat.sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0));

  const empty = emptyFile(businessName, businessNameSource, accounts, uwStatements, warnings, opts.generatedAt);
  if (!flat.length) return empty;

  const periodStart = flat[0].t.date;
  const periodEnd = flat[flat.length - 1].t.date;

  /* ── Positions (reuse the proven engine) ── */
  const plainTxns = flat.map((f) => f.t);
  const grossDepositsRaw = plainTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const monthKeysAll = Array.from(new Set(plainTxns.map((t) => t.date.slice(0, 7))));
  const roughMonthly = grossDepositsRaw / Math.max(1, monthKeysAll.length);

  const streams = findRecurringStreams(plainTxns);
  const basePositions = classifyPositions(streams, periodEnd, roughMonthly);

  // Which transactions belong to which position.
  const posOfTxn = new Map<string, string>();
  const posById = new Map(basePositions.map((p) => [p.id, p]));
  const keysByPosition = new Map<string, string[]>();
  for (const st of streams) {
    const id = `${st.key}|${st.txns[0].date}`;
    if (!posById.has(id)) continue;
    for (const t of st.txns) {
      // A stream transaction may appear in more than one account; match on
      // the flattened rows so the keys line up.
      for (const f of flat) {
        if (f.t === t) {
          posOfTxn.set(f.key, id);
          const arr = keysByPosition.get(id);
          if (arr) arr.push(f.key); else keysByPosition.set(id, [f.key]);
        }
      }
    }
  }

  /* ── Cross-account internal transfers ── */
  const transferPartners = findInternalTransfers(
    flat.map((f) => ({ key: f.key, date: f.t.date, amount: f.t.amount, accountId: f.accountId })),
  );

  /* ── Large threshold, relative to this account ── */
  const magnitudes = flat.map((f) => Math.abs(f.t.amount)).sort((a, b) => a - b);
  const p90 = magnitudes.length ? magnitudes[Math.min(magnitudes.length - 1, Math.floor(magnitudes.length * 0.9))] : 0;
  const largeThreshold = Math.max(p90, median(magnitudes) * 3);

  const depositAmounts = flat.filter((f) => f.t.amount > 0).map((f) => f.t.amount).sort((a, b) => a - b);
  const depositMedian = median(depositAmounts);
  const depositP90 = depositAmounts.length
    ? depositAmounts[Math.min(depositAmounts.length - 1, Math.floor(depositAmounts.length * 0.9))]
    : 0;

  /* ══════════════ Per-transaction classification ══════════════ */
  const transactions: UwTransaction[] = flat.map((f) => {
    const t = f.t;
    const positionId = posOfTxn.get(f.key) ?? null;
    const partner = transferPartners.get(f.key) ?? null;
    const knownFunder = matchKnownFunder(t.description);

    let autoClass: TxnClass;
    let reason: string;
    let weight = 0.6;
    let nonRevenueKind: NonRevenueKind | null = null;
    let bankEventKind: BankEventKind | null = null;
    let funderName: string | null = knownFunder;

    const bankEvent = matchBankEvent(t.description);
    const collection = matchCollection(t.description);

    if (positionId) {
      autoClass = 'mca_payment';
      const p = posById.get(positionId)!;
      funderName = p.funderName;
      reason = `Recurring ${CADENCE_LABEL[p.cadence].toLowerCase()} debit of ${fmt(p.paymentAmount)} to ${p.funderName}`;
      weight = p.confidence === 'high' ? 0.96 : p.confidence === 'medium' ? 0.78 : 0.55;
    } else if (bankEvent) {
      autoClass = 'bank_event';
      bankEventKind = bankEvent.kind;
      reason = `${bankEvent.label} — ${bankEvent.reason}`;
      weight = bankEvent.weight;
    } else if (partner) {
      autoClass = 'non_revenue';
      nonRevenueKind = 'internal_transfer';
      reason = 'Matches an equal, opposite entry in another uploaded account on the same date — money moved between the merchant’s own accounts';
      weight = 0.97;
    } else if (t.amount > 0) {
      // ── Incoming ──
      const nonRev = matchNonRevenue(t.description);
      const processor = matchRevenueProcessor(t.description);
      const outsized = depositMedian > 0 && t.amount >= Math.max(depositMedian * 4, depositP90 * 1.5, 5000);

      if (knownFunder && t.amount >= 2000) {
        autoClass = 'mca_funding';
        nonRevenueKind = 'mca_funding';
        reason = `Deposit from ${knownFunder}, a known MCA funder — advance proceeds, not revenue`;
        weight = 0.95;
      } else if (nonRev) {
        autoClass = 'non_revenue';
        nonRevenueKind = nonRev.kind;
        reason = nonRev.reason;
        weight = nonRev.weight;
      } else if (processor) {
        autoClass = 'revenue';
        reason = processor.reason;
        weight = processor.weight;
      } else if (outsized && (t.amount % 500 === 0 || hasWeakMcaHint(t.description))) {
        autoClass = 'mca_funding';
        nonRevenueKind = 'mca_funding';
        reason = hasWeakMcaHint(t.description)
          ? 'Large deposit with advance/funding wording — possible advance proceeds'
          : `Large round deposit, roughly ${Math.round(t.amount / Math.max(1, depositMedian))}× this account’s typical deposit — possible advance proceeds`;
        weight = 0.6;
      } else {
        autoClass = 'revenue';
        reason = 'Incoming deposit with no transfer, funding, or non-operating marker — treated as operating revenue';
        weight = 0.65;
      }
    } else {
      // ── Outgoing ──
      if (collection) {
        autoClass = 'collection';
        reason = collection.reason;
        weight = collection.weight;
      } else {
        autoClass = 'withdrawal';
        reason = 'Ordinary outgoing payment';
        weight = 0.9;
      }
    }

    const override = overrideMap.get(f.key);
    const cls: TxnClass = override ?? autoClass;
    const overridden = Boolean(override) && override !== autoClass;

    return {
      key: f.key,
      date: t.date,
      description: t.description,
      merchant: normalizedMerchant(t.description),
      amount: t.amount,
      balance: t.balance,
      accountId: f.accountId,
      statementId: f.statementId,
      month: t.date.slice(0, 7),
      cls,
      autoClass,
      overridden,
      isTrueRevenue: t.amount > 0 && cls === 'revenue',
      reason: overridden ? `Manually set to ${TXN_CLASS_LABEL[cls]} (system said ${TXN_CLASS_LABEL[autoClass]}: ${reason})` : reason,
      confidence: overridden ? 'high' : toConfidence(weight),
      weight: overridden ? 1 : weight,
      nonRevenueKind,
      bankEventKind,
      positionId,
      funderName,
      isLarge: largeThreshold > 0 && Math.abs(t.amount) >= largeThreshold,
      internalTransferPartner: partner,
    };
  });

  const byKey = new Map(transactions.map((t) => [t.key, t]));

  /* ══════════════ Revenue: gross → exclusions → true ══════════════ */
  const credits = transactions.filter((t) => t.amount > 0);
  const grossRevenueTotal = credits.reduce((s, t) => s + t.amount, 0);
  const trueRevenueTotal = credits.filter((t) => t.isTrueRevenue).reduce((s, t) => s + t.amount, 0);

  const exclusionBuckets = new Map<string, { label: string; amount: number; count: number }>();
  for (const t of credits) {
    if (t.isTrueRevenue) continue;
    const kind = t.cls === 'mca_funding'
      ? 'mca_funding'
      : (t.nonRevenueKind ?? (t.cls === 'bank_event' ? 'returned_deposit' : 'other_non_operating'));
    const label = NON_REVENUE_KIND_LABEL[kind as NonRevenueKind] ?? 'Excluded';
    const b = exclusionBuckets.get(kind) ?? { label, amount: 0, count: 0 };
    b.amount += t.amount;
    b.count += 1;
    exclusionBuckets.set(kind, b);
  }
  const revenueBridge: RevenueBridge = {
    gross: grossRevenueTotal,
    exclusions: Array.from(exclusionBuckets.entries())
      .map(([kind, v]) => ({ kind, label: v.label, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount),
    trueRevenue: trueRevenueTotal,
  };

  /* ══════════════ Months ══════════════ */
  const balancesAvailable = flat.filter((f) => f.t.balance !== null).length >= flat.length * 0.6;
  const months = buildMonths(transactions, periodStart, periodEnd, balancesAvailable);
  const fullMonths = months.filter((m) => !m.partial);
  const basis = fullMonths.length ? fullMonths : months;
  const monthCount = Math.max(1, basis.length);

  const grossRevenueMonthly = basis.reduce((s, m) => s + m.grossDeposits, 0) / monthCount;
  const trueRevenueMonthly = basis.reduce((s, m) => s + m.trueRevenue, 0) / monthCount;
  const avgMonthlyDeposits = grossRevenueMonthly;
  const avgDepositCount = basis.reduce((s, m) => s + m.depositCount, 0) / monthCount;
  const totalWithdrawals = transactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const balMonths = basis.filter((m) => m.avgDailyBalance !== null);
  const balDays = balMonths.reduce((s, m) => s + m.daysCovered, 0);
  const avgDailyBalance = balMonths.length && balDays > 0
    ? balMonths.reduce((s, m) => s + (m.avgDailyBalance ?? 0) * m.daysCovered, 0) / balDays
    : null;
  const endingMonths = basis.filter((m) => m.endingBalance !== null);
  const avgMonthlyEndingBalance = endingMonths.length
    ? endingMonths.reduce((s, m) => s + (m.endingBalance ?? 0), 0) / endingMonths.length
    : null;

  const lowMonths = months.filter((m) => m.lowBalance !== null);
  const lowestBalance = lowMonths.length ? Math.min(...lowMonths.map((m) => m.lowBalance as number)) : null;
  const highMonths = months.filter((m) => m.highBalance !== null);
  const highestBalance = highMonths.length ? Math.max(...highMonths.map((m) => m.highBalance as number)) : null;

  const negativeDays = buildNegativeDays(transactions, months, balancesAvailable);

  const nsfCount = months.reduce((s, m) => s + m.nsfCount, 0);
  const overdraftCount = months.reduce((s, m) => s + m.overdraftCount, 0);
  const returnedCount = months.reduce((s, m) => s + m.returnedCount, 0);

  /* ══════════════ Funding events ══════════════ */
  const fundingEvents: FundingEventDetail[] = transactions
    .filter((t) => t.cls === 'mca_funding')
    .map((t, i) => ({
      id: `fund-${i}-${t.date}`,
      date: t.date,
      description: t.description,
      amount: t.amount,
      funderName: t.funderName,
      confidence: t.confidence,
      reason: t.reason,
      linkedPositionId: null,
      linkedNote: null,
      txnKey: t.key,
    }));

  /* ══════════════ Positions, enriched ══════════════ */
  const monthKeys = months.map((m) => m.key);
  const positions: UwPosition[] = basePositions.map((p) => {
    const keys = keysByPosition.get(p.id) ?? [];
    const posMonths = new Set(keys.map((k) => byKey.get(k)?.month).filter(Boolean) as string[]);
    const monthsPresent = posMonths.size;
    const monthsInPeriod = monthKeys.length;
    const daysSinceLast = daysBetween(p.lastDate, periodEnd);

    // Status: a position that simply stops is one of the most important
    // signals in the file, so it is never silently treated as current.
    let status: PositionStatus = 'active';
    let statusReason = 'Payments continue through the end of the statement period';
    if (daysSinceLast > 21) {
      const expectedRemaining = p.estimatedPayback && p.estimatedRemaining !== null
        ? p.estimatedRemaining
        : null;
      const returnsNearby = transactions.filter(
        (t) => t.cls === 'bank_event'
          && (t.bankEventKind === 'returned_ach' || t.bankEventKind === 'nsf' || t.bankEventKind === 'stop_payment')
          && Math.abs(daysBetween(p.lastDate, t.date)) <= 14,
      );
      if (returnsNearby.length >= 2) {
        status = 'possible_default';
        statusReason = `Payments stopped on ${p.lastDate} with ${returnsNearby.length} returned/NSF items within two weeks — this looks like a default rather than a payoff`;
      } else if (expectedRemaining !== null && expectedRemaining > 0) {
        status = 'stopped';
        statusReason = `Payments stopped on ${p.lastDate} with an estimated ${fmt(expectedRemaining)} still outstanding — could be a payoff, a refinance, or a stop payment`;
      } else if (expectedRemaining === 0) {
        status = 'paid_off';
        statusReason = `Payments ran their full estimated term and stopped on ${p.lastDate} — consistent with a completed payoff`;
      } else {
        // The advance started before the statements, so there is no way to
        // know how much was left. Calling that "paid off" would be a guess
        // in the merchant's favour, which is the wrong way to be wrong.
        status = 'stopped';
        statusReason = `Payments stopped on ${p.lastDate}. This advance started before the uploaded statements, so how much was left cannot be determined — needs review to tell a payoff from a refinance or a stop payment`;
      }
    }

    const weeklyEquivalent = p.monthlyEquivalent / WEEKS_PER_MONTH;
    const fundingLink = fundingEvents.find(
      (f) => (f.funderName && f.funderName === p.funderName)
        && daysBetween(f.date, p.firstDate) >= -3 && daysBetween(f.date, p.firstDate) <= 21,
    );
    if (fundingLink) {
      fundingLink.linkedPositionId = p.id;
      fundingLink.linkedNote = `Payments of ${fmt(p.paymentAmount)} ${CADENCE_LABEL[p.cadence].toLowerCase()} begin ${p.firstDate}`;
    }

    const decision = opts.positionDecisions?.[p.id];

    return {
      ...p,
      status,
      statusReason,
      monthsPresent,
      monthsInPeriod,
      presentThroughout: monthsInPeriod > 1 && monthsPresent >= monthsInPeriod,
      weeklyEquivalent,
      withholdPct: pct(p.monthlyEquivalent, trueRevenueMonthly),
      confidenceLevel: p.confidence === 'high' ? 'high' : p.confidence === 'medium' ? 'likely' : 'possible',
      fundingEventId: fundingLink?.id ?? null,
      txnKeys: keys,
      userConfirmed: decision === undefined ? null : decision,
    };
  });

  const currentPositions = positions.filter((p) => p.status === 'active' && p.userConfirmed !== false);
  const historicalPositions = positions.filter((p) => p.status !== 'active' || p.userConfirmed === false);

  const mcaMonthlyPayments = currentPositions.reduce((s, p) => s + p.monthlyEquivalent, 0);
  const mcaWeeklyPayments = currentPositions.reduce((s, p) => s + p.weeklyEquivalent, 0);

  const withhold: WithholdAudit = {
    trueRevenueMonthly,
    positions: currentPositions.map((p) => ({ name: p.funderName, monthly: p.monthlyEquivalent })),
    totalMonthly: mcaMonthlyPayments,
    pct: pct(mcaMonthlyPayments, trueRevenueMonthly),
  };

  /* ══════════════ Collections ══════════════ */
  const collectionGroups = new Map<string, CollectionActivity>();
  for (const t of transactions) {
    if (t.cls !== 'collection') continue;
    const g = collectionGroups.get(t.merchant) ?? {
      id: `col-${t.merchant}`,
      payee: t.merchant,
      total: 0,
      count: 0,
      confidence: t.confidence,
      reason: t.reason,
      txnKeys: [],
    };
    g.total += Math.abs(t.amount);
    g.count += 1;
    g.txnKeys.push(t.key);
    if (t.weight > 0.8) g.confidence = t.confidence;
    collectionGroups.set(t.merchant, g);
  }
  const collections = Array.from(collectionGroups.values()).sort((a, b) => b.total - a.total);

  /* ══════════════ Risk flags ══════════════ */
  const riskFlags = buildRiskFlags({
    transactions, positions, months, negativeDays, collections,
    trueRevenueMonthly, withholdPct: withhold.pct, periodEnd, fundingEvents,
  });

  /* ══════════════ Revenue sources (for the review tab) ══════════════ */
  const sourceGroups = new Map<string, RevenueSource>();
  for (const t of credits) {
    const g = sourceGroups.get(t.merchant) ?? {
      merchant: t.merchant,
      label: t.merchant,
      total: 0,
      count: 0,
      autoClass: t.autoClass,
      classification: t.cls === 'revenue' ? 'Revenue' : (t.nonRevenueKind ? NON_REVENUE_KIND_LABEL[t.nonRevenueKind] : TXN_CLASS_LABEL[t.cls]),
      isTrueRevenue: t.isTrueRevenue,
      overridden: false,
      confidence: t.confidence,
      reason: t.reason,
      keys: [],
    };
    g.total += t.amount;
    g.count += 1;
    g.keys.push(t.key);
    if (t.overridden) g.overridden = true;
    // A group is "true revenue" when the majority of its money counts.
    sourceGroups.set(t.merchant, g);
  }
  for (const g of sourceGroups.values()) {
    const included = g.keys.map((k) => byKey.get(k)!).filter((t) => t.isTrueRevenue).reduce((s, t) => s + t.amount, 0);
    g.isTrueRevenue = included > g.total / 2;
  }
  const revenueSources = Array.from(sourceGroups.values()).sort((a, b) => b.total - a.total);

  /* ══════════════ Trends ══════════════ */
  const { trend: revenueTrend, pctChange: revenueTrendPct } = trendOf(basis.map((m) => m.trueRevenue));
  const { trend: balanceTrend } = trendOf(
    basis.map((m) => m.avgDailyBalance).filter((v): v is number => v !== null),
  );

  return {
    hasData: true,
    businessName,
    businessNameSource,
    periodStart,
    periodEnd,
    monthsCovered: Math.max(1, Math.round((daysBetween(periodStart, periodEnd) + 1) / 30.44)),
    statementCount: uwStatements.length,
    accountCount: accounts.size,
    generatedAt: opts.generatedAt ?? '',

    accounts: Array.from(accounts.values()),
    statements: uwStatements,
    transactions,
    months,

    grossRevenueTotal,
    grossRevenueMonthly,
    trueRevenueTotal,
    trueRevenueMonthly,
    revenueBridge,
    avgDailyBalance,
    lowestBalance,
    highestBalance,
    avgMonthlyEndingBalance,
    avgMonthlyDeposits,
    avgDepositCount,
    totalWithdrawals,
    negativeDays,
    nsfCount,
    overdraftCount,
    returnedCount,

    positions,
    currentPositions,
    historicalPositions,
    mcaMonthlyPayments,
    mcaWeeklyPayments,
    withhold,
    fundingEvents,
    collections,
    riskFlags,
    revenueSources,

    revenueTrend,
    balanceTrend,
    revenueTrendPct,
    balancesAvailable,
    largeThreshold,
    warnings,
  };
}

/* ═════════════════════════ month builder ═════════════════════════ */

function buildMonths(
  txns: UwTransaction[],
  periodStart: string,
  periodEnd: string,
  balancesAvailable: boolean,
): MonthRow[] {
  const byMonth = new Map<string, UwTransaction[]>();
  for (const t of txns) {
    const arr = byMonth.get(t.month);
    if (arr) arr.push(t); else byMonth.set(t.month, [t]);
  }

  const rows: MonthRow[] = [];
  for (const key of Array.from(byMonth.keys()).sort()) {
    const list = byMonth.get(key)!;
    let grossDeposits = 0, trueRevenue = 0, withdrawals = 0, depositCount = 0;
    let largestDeposit = 0, mcaPayments = 0;
    let nsfCount = 0, overdraftCount = 0, returnedCount = 0;

    for (const t of list) {
      if (t.amount > 0) {
        grossDeposits += t.amount;
        depositCount++;
        if (t.amount > largestDeposit) largestDeposit = t.amount;
        if (t.isTrueRevenue) trueRevenue += t.amount;
      } else {
        withdrawals += Math.abs(t.amount);
        if (t.cls === 'mca_payment') mcaPayments += Math.abs(t.amount);
      }
    }

    /* Bank events, de-duplicated by day.
       A single bounced payment often prints twice — the returned item AND
       its fee. Counting both would double the NSF count, which is one of
       the numbers funders look at hardest. So per day: if a real event
       line exists, the fee lines on that day are its fee and are not
       counted again. A fee with no event line IS the only evidence of the
       event, so it counts. Kinds stay tracked separately either way. */
    const eventsByDay = new Map<string, UwTransaction[]>();
    for (const t of list) {
      if (t.cls !== 'bank_event') continue;
      const arr = eventsByDay.get(t.date);
      if (arr) arr.push(t); else eventsByDay.set(t.date, [t]);
    }
    for (const dayEvents of eventsByDay.values()) {
      const nonFee = dayEvents.filter((t) => !isFeeLine(t.description));
      const counted = nonFee.length ? nonFee : dayEvents;
      for (const t of counted) {
        if (t.bankEventKind === 'overdraft_fee') overdraftCount++;
        else if (t.bankEventKind === 'returned_ach') returnedCount++;
        else if (t.bankEventKind === 'nsf') nsfCount++;
      }
    }

    // Daily ending balances → negative days, low/high, average.
    let negativeDays = 0;
    let avgDailyBalance: number | null = null;
    let lowBalance: number | null = null;
    let highBalance: number | null = null;
    let endingBalance: number | null = null;

    if (balancesAvailable) {
      const dayEnd = dailyEndingBalances(list);
      const days = Array.from(dayEnd.keys()).sort();
      if (days.length) {
        const series = expandDaily(dayEnd, days);
        const values = series.map((d) => d.balance);
        negativeDays = values.filter((v) => v < 0).length;
        lowBalance = Math.min(...values);
        highBalance = Math.max(...values);
        endingBalance = values[values.length - 1];
        avgDailyBalance = values.reduce((s, v) => s + v, 0) / values.length;
      }
    }

    const [yy, mm] = key.split('-').map(Number);
    const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const monthFirst = `${key}-01`;
    const monthLast = `${key}-${lastDay < 10 ? '0' : ''}${lastDay}`;
    const from = monthFirst > periodStart ? monthFirst : periodStart;
    const to = monthLast < periodEnd ? monthLast : periodEnd;
    const daysCovered = Math.max(1, daysBetween(from, to) + 1);

    rows.push({
      key,
      label: monthLabel(key),
      daysCovered,
      partial: daysCovered < 20,
      grossDeposits,
      trueRevenue,
      withdrawals,
      depositCount,
      avgDepositSize: depositCount ? grossDeposits / depositCount : 0,
      largestDeposit,
      avgDailyBalance,
      lowBalance,
      highBalance,
      endingBalance,
      negativeDays,
      nsfCount,
      overdraftCount,
      returnedCount,
      mcaPayments,
      mcaWithholdPct: pct(mcaPayments, trueRevenue),
    });
  }
  return rows;
}

/** Last balance seen on each day. */
function dailyEndingBalances(txns: UwTransaction[]): Map<string, number> {
  const dayEnd = new Map<string, number>();
  const sorted = [...txns].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const t of sorted) {
    if (t.balance === null) continue;
    dayEnd.set(t.date, t.balance);
  }
  return dayEnd;
}

/** Carry each closing balance forward across days with no activity. */
function expandDaily(dayEnd: Map<string, number>, days: string[]): { date: string; balance: number }[] {
  const out: { date: string; balance: number }[] = [];
  const first = Date.parse(`${days[0]}T00:00:00Z`);
  const last = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  const span = Math.max(1, Math.round((last - first) / 86400000) + 1);
  let running = dayEnd.get(days[0]) ?? 0;
  for (let i = 0; i < span; i++) {
    const iso = new Date(first + i * 86400000).toISOString().slice(0, 10);
    if (dayEnd.has(iso)) running = dayEnd.get(iso)!;
    out.push({ date: iso, balance: running });
  }
  return out;
}

function buildNegativeDays(
  txns: UwTransaction[],
  months: MonthRow[],
  balancesAvailable: boolean,
): NegativeDayDetail {
  const blank: NegativeDayDetail = {
    totalNegativeDays: 0, perMonth: [], longestRun: 0, longestRunStart: null,
    longestRunEnd: null, lowestBalance: null, averageNegativeBalance: null, dates: [],
  };
  if (!balancesAvailable) return blank;

  const dayEnd = dailyEndingBalances(txns);
  const days = Array.from(dayEnd.keys()).sort();
  if (!days.length) return blank;

  const series = expandDaily(dayEnd, days);
  const negatives = series.filter((d) => d.balance < 0);

  let longestRun = 0, runStart: string | null = null, runEnd: string | null = null;
  let current = 0, currentStart: string | null = null;
  for (const d of series) {
    if (d.balance < 0) {
      if (current === 0) currentStart = d.date;
      current++;
      if (current > longestRun) { longestRun = current; runStart = currentStart; runEnd = d.date; }
    } else {
      current = 0;
      currentStart = null;
    }
  }

  return {
    totalNegativeDays: negatives.length,
    perMonth: months.map((m) => ({
      month: m.key,
      label: m.label,
      days: m.negativeDays,
    })),
    longestRun,
    longestRunStart: runStart,
    longestRunEnd: runEnd,
    lowestBalance: Math.min(...series.map((d) => d.balance)),
    averageNegativeBalance: negatives.length
      ? negatives.reduce((s, d) => s + d.balance, 0) / negatives.length
      : null,
    dates: negatives,
  };
}

/* ═════════════════════════ risk engine ═════════════════════════ */

function buildRiskFlags(ctx: {
  transactions: UwTransaction[];
  positions: UwPosition[];
  months: MonthRow[];
  negativeDays: NegativeDayDetail;
  collections: CollectionActivity[];
  trueRevenueMonthly: number;
  withholdPct: number;
  periodEnd: string;
  fundingEvents: FundingEventDetail[];
}): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const { transactions, positions, negativeDays, collections, withholdPct, periodEnd } = ctx;

  // ── Stopped positions ──
  for (const p of positions) {
    if (p.status === 'possible_default') {
      flags.push({
        id: `risk-default-${p.id}`,
        severity: 'high',
        title: `Possible default — ${p.funderName}`,
        explanation: p.statusReason,
        confidence: 'likely',
        txnKeys: p.txnKeys.slice(-8),
      });
    } else if (p.status === 'stopped') {
      flags.push({
        id: `risk-stopped-${p.id}`,
        severity: 'medium',
        title: `Possible stop payment — ${p.funderName}`,
        explanation: `${p.paymentCount} payments of ${fmt(p.paymentAmount)} ran ${CADENCE_LABEL[p.cadence].toLowerCase()} from ${p.firstDate} and stopped abruptly on ${p.lastDate}, ${daysBetween(p.lastDate, periodEnd)} days before the statements end. ${p.statusReason}`,
        confidence: 'possible',
        txnKeys: p.txnKeys.slice(-8),
      });
    }
  }

  // ── Several positions stopping together: the classic "changed banks or
  //    stopped paying everyone" pattern, and much worse than one stopping.
  const stopped = positions.filter((p) => p.status === 'stopped' || p.status === 'possible_default');
  if (stopped.length >= 2) {
    const dates = stopped.map((p) => p.lastDate).sort();
    const spread = daysBetween(dates[0], dates[dates.length - 1]);
    if (spread <= 14) {
      flags.push({
        id: 'risk-mass-stop',
        severity: 'high',
        title: `${stopped.length} MCA positions stopped within ${spread} days of each other`,
        explanation: `Payments to ${stopped.map((p) => p.funderName).join(', ')} all stopped between ${dates[0]} and ${dates[dates.length - 1]}. Several funders losing their debit at once usually means the merchant blocked the debits, moved banks, or entered a workout — not that every advance paid off at the same time.`,
        confidence: 'likely',
        txnKeys: stopped.flatMap((p) => p.txnKeys.slice(-3)),
      });
    }
  }

  // ── Returned ACH / stop payment / block descriptors ──
  const returns = transactions.filter(
    (t) => t.cls === 'bank_event' && (t.bankEventKind === 'returned_ach' || t.bankEventKind === 'nsf'),
  );
  if (returns.length >= 3) {
    flags.push({
      id: 'risk-returns',
      severity: returns.length >= 6 ? 'high' : 'medium',
      title: `${returns.length} returned items / NSFs across the period`,
      explanation: `Repeated returns tell a funder the account cannot reliably support a daily debit. Dates: ${returns.slice(0, 6).map((t) => t.date).join(', ')}${returns.length > 6 ? '…' : ''}.`,
      confidence: 'high',
      txnKeys: returns.slice(0, 12).map((t) => t.key),
    });
  }

  const stops = transactions.filter((t) => t.bankEventKind === 'stop_payment' || t.bankEventKind === 'ach_block');
  if (stops.length) {
    flags.push({
      id: 'risk-stop-descriptor',
      severity: 'high',
      title: `${stops.length} stop-payment / ACH-block entr${stops.length === 1 ? 'y' : 'ies'} on the statements`,
      explanation: 'The bank recorded an explicit stop payment or debit block. This is the strongest single signal that the merchant deliberately cut off a funder.',
      confidence: 'high',
      txnKeys: stops.map((t) => t.key),
    });
  }

  // ── NSFs clustered around MCA debit dates ──
  const mcaDates = new Set(transactions.filter((t) => t.cls === 'mca_payment').map((t) => t.date));
  const nsfNearMca = transactions.filter(
    (t) => t.cls === 'bank_event' && t.bankEventKind !== 'overdraft_fee'
      && Array.from(mcaDates).some((d) => Math.abs(daysBetween(d, t.date)) <= 1),
  );
  if (nsfNearMca.length >= 2) {
    flags.push({
      id: 'risk-nsf-near-mca',
      severity: 'medium',
      title: `${nsfNearMca.length} NSF / returned items landed on or next to an MCA debit date`,
      explanation: 'When returns cluster around the advance debit dates, the merchant is failing to fund the advance specifically rather than just running a thin balance.',
      confidence: 'likely',
      txnKeys: nsfNearMca.slice(0, 12).map((t) => t.key),
    });
  }

  // ── Collections ──
  for (const c of collections) {
    if (c.confidence === 'possible' || c.confidence === 'review') continue;
    flags.push({
      id: `risk-collection-${c.payee}`,
      severity: c.confidence === 'high' ? 'high' : 'medium',
      title: `Possible collection activity — ${c.payee}`,
      explanation: `${c.count} payment${c.count === 1 ? '' : 's'} totalling ${fmt(c.total)}. ${c.reason}. Payments to a settlement or workout firm usually mean the merchant is already in trouble with another funder.`,
      confidence: c.confidence,
      txnKeys: c.txnKeys,
    });
  }

  // ── Leverage ──
  if (withholdPct > 0.3) {
    flags.push({
      id: 'risk-withhold',
      severity: 'high',
      title: `MCA withhold is ${(withholdPct * 100).toFixed(1)}% of true revenue`,
      explanation: 'Above roughly 30% there is no room for another position without a consolidation or a payoff.',
      confidence: 'high',
      txnKeys: [],
    });
  } else if (withholdPct > 0.2) {
    flags.push({
      id: 'risk-withhold',
      severity: 'medium',
      title: `MCA withhold is ${(withholdPct * 100).toFixed(1)}% of true revenue`,
      explanation: 'Existing advances are taking a meaningful share of revenue; new money will be limited.',
      confidence: 'high',
      txnKeys: [],
    });
  }

  // ── Negative days ──
  if (negativeDays.totalNegativeDays > 0) {
    const severity: RiskSeverity = negativeDays.totalNegativeDays > 10 ? 'high' : negativeDays.totalNegativeDays > 4 ? 'medium' : 'low';
    flags.push({
      id: 'risk-negative-days',
      severity,
      title: `${negativeDays.totalNegativeDays} negative day${negativeDays.totalNegativeDays === 1 ? '' : 's'}`,
      explanation: `Counted from daily ending balances, not from individual transactions. Longest run: ${negativeDays.longestRun} consecutive day${negativeDays.longestRun === 1 ? '' : 's'}${negativeDays.longestRunStart ? ` starting ${negativeDays.longestRunStart}` : ''}. Lowest balance ${negativeDays.lowestBalance !== null ? fmt(negativeDays.lowestBalance) : 'n/a'}.`,
      confidence: 'high',
      txnKeys: [],
    });
  }

  // ── Revenue concentration ──
  const credits = transactions.filter((t) => t.isTrueRevenue);
  const totalTrue = credits.reduce((s, t) => s + t.amount, 0);
  if (totalTrue > 0) {
    const byPayer = new Map<string, number>();
    for (const t of credits) byPayer.set(t.merchant, (byPayer.get(t.merchant) ?? 0) + t.amount);
    const [topPayer, topAmount] = Array.from(byPayer.entries()).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    if (topAmount / totalTrue > 0.6 && byPayer.size > 1) {
      flags.push({
        id: 'risk-concentration',
        severity: 'medium',
        title: `${Math.round((topAmount / totalTrue) * 100)}% of true revenue comes from one source`,
        explanation: `${topPayer} accounts for ${fmt(topAmount)} of ${fmt(totalTrue)}. Losing one payer would take most of the revenue with it.`,
        confidence: 'high',
        txnKeys: credits.filter((t) => t.merchant === topPayer).slice(0, 10).map((t) => t.key),
      });
    }
  }

  const order: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* ═════════════════════════ trends ═════════════════════════ */

function trendOf(values: number[]): { trend: 'growing' | 'stable' | 'declining' | 'unknown'; pctChange: number } {
  if (values.length < 2) return { trend: 'unknown', pctChange: 0 };
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0) return { trend: 'unknown', pctChange: 0 };
  const change = (last - first) / Math.abs(first);
  if (change > 0.1) return { trend: 'growing', pctChange: change };
  if (change < -0.1) return { trend: 'declining', pctChange: change };
  return { trend: 'stable', pctChange: change };
}

/* ═════════════════════════ empty file ═════════════════════════ */

function emptyFile(
  businessName: string,
  businessNameSource: UnderwritingFile['businessNameSource'],
  accounts: Map<string, UwAccount>,
  statements: UwStatement[],
  warnings: string[],
  generatedAt?: string,
): UnderwritingFile {
  return {
    hasData: false,
    businessName,
    businessNameSource,
    periodStart: '', periodEnd: '', monthsCovered: 0,
    statementCount: statements.length,
    accountCount: accounts.size,
    generatedAt: generatedAt ?? '',
    accounts: Array.from(accounts.values()),
    statements,
    transactions: [], months: [],
    grossRevenueTotal: 0, grossRevenueMonthly: 0, trueRevenueTotal: 0, trueRevenueMonthly: 0,
    revenueBridge: { gross: 0, exclusions: [], trueRevenue: 0 },
    avgDailyBalance: null, lowestBalance: null, highestBalance: null,
    avgMonthlyEndingBalance: null, avgMonthlyDeposits: 0, avgDepositCount: 0, totalWithdrawals: 0,
    negativeDays: {
      totalNegativeDays: 0, perMonth: [], longestRun: 0, longestRunStart: null,
      longestRunEnd: null, lowestBalance: null, averageNegativeBalance: null, dates: [],
    },
    nsfCount: 0, overdraftCount: 0, returnedCount: 0,
    positions: [], currentPositions: [], historicalPositions: [],
    mcaMonthlyPayments: 0, mcaWeeklyPayments: 0,
    withhold: { trueRevenueMonthly: 0, positions: [], totalMonthly: 0, pct: 0 },
    fundingEvents: [], collections: [], riskFlags: [], revenueSources: [],
    revenueTrend: 'unknown', balanceTrend: 'unknown', revenueTrendPct: 0,
    balancesAvailable: false, largeThreshold: 0, warnings,
  };
}

/* ═════════════ handoff to the existing funder matching ═════════════ */

/**
 * Shape the underwriting result into the criteria object the EXISTING
 * funder matching engine already consumes (src/lib/matching/engine.ts).
 *
 * Deliberately does not invent new funder fields or new matching rules —
 * it feeds the two things underwriting actually establishes (monthly
 * revenue and open position count) into the criteria the funder database
 * already stores, and leaves industry/state/credit to the caller since
 * those are deal facts, not statement facts.
 */
export function toDealCriteria(
  file: UnderwritingFile,
  extra: { industry?: string; state?: string; creditScoreValue?: number | null; dealType?: 'standard_mca' | 'reverse_consolidation' } = {},
): {
  monthlyRevenue: number;
  positions: number;
  industry: string;
  state: string;
  creditScoreValue: number | null;
  dealType: 'standard_mca' | 'reverse_consolidation';
} {
  return {
    monthlyRevenue: Math.round(file.trueRevenueMonthly),
    positions: file.currentPositions.length,
    industry: extra.industry ?? 'other',
    state: extra.state ?? 'other',
    creditScoreValue: extra.creditScoreValue ?? null,
    dealType: extra.dealType ?? 'standard_mca',
  };
}

/** Everything another part of the CRM might want from an underwriting file. */
export function toUnderwritingSummary(file: UnderwritingFile) {
  return {
    businessName: file.businessName,
    periodStart: file.periodStart,
    periodEnd: file.periodEnd,
    monthsCovered: file.monthsCovered,
    trueRevenueMonthly: file.trueRevenueMonthly,
    grossRevenueMonthly: file.grossRevenueMonthly,
    avgDailyBalance: file.avgDailyBalance,
    lowestBalance: file.lowestBalance,
    negativeDays: file.negativeDays.totalNegativeDays,
    nsfCount: file.nsfCount,
    overdraftCount: file.overdraftCount,
    mcaPositionCount: file.currentPositions.length,
    mcaMonthlyPayments: file.mcaMonthlyPayments,
    mcaWithholdPct: file.withhold.pct,
    hasCollections: file.collections.length > 0,
    hasPossibleDefault: file.positions.some((p) => p.status === 'possible_default'),
    revenueTrend: file.revenueTrend,
    balanceTrend: file.balanceTrend,
    recentFundings: file.fundingEvents.length,
  };
}
