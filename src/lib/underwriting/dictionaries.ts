/**
 * Underwriting dictionaries — the configurable classification layer.
 *
 * Every rule the scrub uses to label a transaction lives here rather than
 * being scattered through the analysis code. Adding a funder, a collection
 * agency, or a new ACH descriptor is a one-line edit to a table in this
 * file; no analysis logic changes.
 *
 * Funder names themselves live in ./funders.ts (they were already there and
 * are used elsewhere); this file holds everything else — revenue
 * processors, non-operating deposits, NSF/overdraft/return descriptors,
 * stop-payment codes, and debt-collection activity.
 *
 * Every matcher returns the REASON it matched, because a classification the
 * underwriter can't audit is worthless to them.
 */

export interface DictionaryHit {
  /** Stable code for the rule that fired. */
  code: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Why this rule fired, in plain language. */
  reason: string;
  /** 0–1. How sure the rule is when it matches. */
  weight: number;
}

/** Uppercase + collapse punctuation so patterns match reliably. */
export function normalize(raw: string): string {
  return ` ${String(raw || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;
}

/**
 * Token-boundary match.
 *
 * normalize() pads both sides with a space, so comparing the PADDED needle
 * against the PADDED haystack means a pattern only matches whole words.
 * This matters more than it looks: "TRANSFER" contains the letters "NSF",
 * so a raw substring match turns every transfer line on a statement into
 * an NSF. Never trim the needle here.
 */
function contains(haystackNorm: string, needle: string): boolean {
  return haystackNorm.includes(normalize(needle));
}

/* ══════════════════════ Revenue processors ══════════════════════ */

/**
 * Payment processors and marketplaces. A deposit from one of these is
 * about as close to "definitely operating revenue" as a bank statement
 * gets, and it is the single most useful positive signal in the file.
 */
export const REVENUE_PROCESSORS: { name: string; aliases: string[] }[] = [
  { name: 'Stripe', aliases: ['STRIPE'] },
  { name: 'Square', aliases: ['SQUARE INC', 'SQUARE PAYMENT', 'GOSQ', 'SQUARE'] },
  { name: 'Toast', aliases: ['TOAST POS', 'TOAST INC'] },
  { name: 'Clover', aliases: ['CLOVER APP', 'CLOVER PAYMENT'] },
  { name: 'Shopify', aliases: ['SHOPIFY PAYMENT', 'SHOPIFY PAYOUT'] },
  { name: 'PayPal', aliases: ['PAYPAL TRANSFER', 'PAYPAL INST XFER', 'PAYPAL'] },
  { name: 'Amazon', aliases: ['AMAZON PAYMENTS', 'AMZN MKTPLACE PMT', 'AMAZON MKTPLC'] },
  { name: 'Fiserv / First Data', aliases: ['FIRST DATA DEP', 'FISERV DEP', 'BANKCARD DEP', 'MERCH SETTLE'] },
  { name: 'Worldpay', aliases: ['WORLDPAY DEP', 'VANTIV DEP'] },
  { name: 'Global Payments', aliases: ['GLOBAL PAYMENTS DEP', 'TSYS DEP'] },
  { name: 'Elavon', aliases: ['ELAVON DEP'] },
  { name: 'Merchant services', aliases: ['MERCHANT SVCS', 'MERCHANT SERVICES', 'MERCH DEP', 'CARD SETTLEMENT', 'BANKCARD'] },
  { name: 'Uber / Lyft', aliases: ['UBER BV', 'UBER USA', 'LYFT INC'] },
  { name: 'DoorDash / Grubhub', aliases: ['DOORDASH', 'GRUBHUB', 'UBEREATS'] },
  { name: 'Zelle / customer payment', aliases: ['ZELLE PAYMENT FROM', 'QUICKPAY FROM'] },
  { name: 'Insurance / claim payer', aliases: ['CHANGE HEALTHCARE', 'ZELIS', 'AVAILITY', 'ECHO HEALTH'] },
  { name: 'Freight / factoring settlement', aliases: ['RTS FINANCIAL', 'TRIUMPH PAY', 'COMDATA SETTLE'] },
];

export function matchRevenueProcessor(description: string): DictionaryHit | null {
  const norm = normalize(description);
  for (const p of REVENUE_PROCESSORS) {
    for (const a of p.aliases) {
      if (contains(norm, a)) {
        return {
          code: `processor:${p.name}`,
          label: p.name,
          reason: `Deposit from ${p.name}, a payment processor — this is operating revenue`,
          weight: 0.95,
        };
      }
    }
  }
  return null;
}

/* ══════════════════ Non-operating deposits ══════════════════ */

export type NonRevenueKind =
  | 'internal_transfer'
  | 'owner_transfer'
  | 'loan_proceeds'
  | 'mca_funding'
  | 'credit_card_advance'
  | 'returned_deposit'
  | 'reversal'
  | 'tax_refund'
  | 'investment'
  | 'other_non_operating';

export const NON_REVENUE_KIND_LABEL: Record<NonRevenueKind, string> = {
  internal_transfer: 'Internal transfer',
  owner_transfer: 'Owner transfer',
  loan_proceeds: 'Loan proceeds',
  mca_funding: 'MCA funding',
  credit_card_advance: 'Credit card advance',
  returned_deposit: 'Returned deposit',
  reversal: 'Reversal',
  tax_refund: 'Tax refund',
  investment: 'Investment transfer',
  other_non_operating: 'Non-operating deposit',
};

interface NonRevenueRule {
  kind: NonRevenueKind;
  patterns: string[];
  weight: number;
}

/**
 * Deposits that inflate the deposit total without being sales.
 *
 * Getting these OUT is the whole point of True Revenue — a file that looks
 * like $200k/month of revenue but is really $120k of sales plus transfers
 * and an advance is a completely different deal.
 */
export const NON_REVENUE_RULES: NonRevenueRule[] = [
  {
    kind: 'internal_transfer',
    weight: 0.9,
    patterns: [
      'TRANSFER FROM', 'ONLINE TRANSFER FROM', 'INTERNAL TRANSFER', 'BOOK TRANSFER',
      'TRSF FROM', 'XFER FROM', 'ACCOUNT TRANSFER', 'FUNDS TRANSFER FROM',
      'TRANSFER FROM SAVINGS', 'TRANSFER FROM CHECKING', 'SWEEP FROM',
    ],
  },
  {
    kind: 'owner_transfer',
    weight: 0.7,
    patterns: ['OWNER DEPOSIT', 'OWNER CONTRIBUTION', 'MEMBER CONTRIBUTION', 'CAPITAL CONTRIBUTION', 'SHAREHOLDER LOAN'],
  },
  {
    kind: 'loan_proceeds',
    weight: 0.85,
    patterns: ['LOAN PROCEED', 'LOAN ADVANCE', 'LOAN DISBURSEMENT', 'SBA LOAN DISB', 'EIDL', 'LINE OF CREDIT ADVANCE', 'LOC ADVANCE', 'DRAW ADVANCE'],
  },
  {
    kind: 'mca_funding',
    weight: 0.9,
    patterns: ['ADVANCE FUNDING', 'FUNDING PROCEED', 'MERCHANT ADVANCE DEP', 'ADVANCE DEPOSIT', 'PURCHASE OF RECEIVABLES'],
  },
  {
    kind: 'credit_card_advance',
    weight: 0.8,
    patterns: ['CASH ADVANCE', 'CREDIT CARD ADVANCE', 'BALANCE TRANSFER'],
  },
  {
    kind: 'returned_deposit',
    weight: 0.9,
    patterns: ['RETURNED DEPOSIT', 'DEPOSIT RETURN', 'RETURNED ITEM CREDIT', 'REDEPOSIT'],
  },
  {
    kind: 'reversal',
    weight: 0.9,
    patterns: ['REVERSAL', 'REVERSED', 'ADJUSTMENT CREDIT', 'ERROR CORRECTION', 'CHARGEBACK CREDIT'],
  },
  {
    kind: 'tax_refund',
    weight: 0.85,
    patterns: ['IRS TREAS', 'TAX REF', 'TAX REFUND', 'STATE TAX REF', 'FRANCHISE TAX BD'],
  },
  {
    kind: 'investment',
    weight: 0.7,
    patterns: ['INVESTMENT TRANSFER', 'BROKERAGE TRANSFER', 'FIDELITY', 'SCHWAB TRANSFER', 'VANGUARD'],
  },
  {
    kind: 'other_non_operating',
    weight: 0.6,
    patterns: ['REFUND', 'REBATE', 'CREDIT MEMO', 'COUNTER CREDIT', 'CASH DEPOSIT REVERSAL'],
  },
];

export function matchNonRevenue(description: string): (DictionaryHit & { kind: NonRevenueKind }) | null {
  const norm = normalize(description);
  for (const rule of NON_REVENUE_RULES) {
    for (const p of rule.patterns) {
      if (contains(norm, p)) {
        return {
          kind: rule.kind,
          code: `nonrev:${rule.kind}`,
          label: NON_REVENUE_KIND_LABEL[rule.kind],
          reason: `Description contains "${p}" — ${NON_REVENUE_KIND_LABEL[rule.kind].toLowerCase()}, not operating revenue`,
          weight: rule.weight,
        };
      }
    }
  }
  return null;
}

/* ══════════════════ NSF / overdraft / returns ══════════════════ */

export type BankEventKind = 'nsf' | 'overdraft_fee' | 'returned_ach' | 'stop_payment' | 'ach_block';

export const BANK_EVENT_LABEL: Record<BankEventKind, string> = {
  nsf: 'NSF / insufficient funds',
  overdraft_fee: 'Overdraft fee',
  returned_ach: 'Returned ACH / item',
  stop_payment: 'Stop payment',
  ach_block: 'ACH block / debit blocked',
};

interface BankEventRule {
  kind: BankEventKind;
  patterns: string[];
  /** True when the line is the FEE for an event rather than the event. */
  isFee: boolean;
}

/**
 * Bank events, split by kind so NSFs, overdraft fees, and returned ACHs
 * can be counted separately — and so a single bounced payment that shows
 * up as both a returned item AND its fee is not counted twice.
 */
export const BANK_EVENT_RULES: BankEventRule[] = [
  { kind: 'nsf', isFee: false, patterns: ['NSF', 'NON SUFFICIENT', 'NONSUFFICIENT', 'INSUFFICIENT FUNDS', 'INSUFFICIENT FUND'] },
  { kind: 'overdraft_fee', isFee: true, patterns: ['OVERDRAFT FEE', 'OVERDRAFT CHARGE', 'OD FEE', 'EXTENDED OVERDRAFT', 'UNCOLLECTED FUNDS FEE', 'OVERDRAFT ITEM FEE'] },
  { kind: 'returned_ach', isFee: false, patterns: ['RETURNED ITEM', 'RETURN ITEM', 'RETURNED CHECK', 'RETURNED ACH', 'ACH RETURN', 'RETURNED PAYMENT', 'UNPAID ITEM', 'ITEM RETURNED', 'RETURN DEBIT'] },
  { kind: 'stop_payment', isFee: false, patterns: ['STOP PAYMENT', 'STOP PAY', 'STOPPAYMENT', 'PAYMENT STOPPED'] },
  { kind: 'ach_block', isFee: false, patterns: ['ACH BLOCK', 'DEBIT BLOCK', 'ACH DEBIT BLOCKED', 'TRANSACTION BLOCKED', 'AUTHORIZATION REVOKED'] },
];

export function matchBankEvent(description: string): (DictionaryHit & { kind: BankEventKind; isFee: boolean }) | null {
  const norm = normalize(description);
  for (const rule of BANK_EVENT_RULES) {
    for (const p of rule.patterns) {
      if (contains(norm, p)) {
        return {
          kind: rule.kind,
          isFee: rule.isFee,
          code: `bank:${rule.kind}`,
          label: BANK_EVENT_LABEL[rule.kind],
          reason: `Description contains "${p}"`,
          weight: 0.95,
        };
      }
    }
  }
  return null;
}

/** A fee line for an event, used to avoid double-counting one bounce. */
export function isFeeLine(description: string): boolean {
  const norm = normalize(description);
  return /\bFEE\b|\bCHARGE\b/.test(norm);
}

/* ══════════════════ Debt collection / settlement ══════════════════ */

/**
 * Known collection, debt-settlement, and MCA-workout outfits.
 *
 * A payment to one of these is a serious signal — it usually means the
 * merchant is already in trouble with another funder.
 */
export const COLLECTION_COMPANIES: { name: string; aliases: string[] }[] = [
  { name: 'Corporate Turnaround', aliases: ['CORPORATE TURNAROUND'] },
  { name: 'Second Wind Consultants', aliases: ['SECOND WIND CONSULT'] },
  { name: 'Reliant Account Management', aliases: ['RELIANT ACCOUNT MGMT', 'RELIANT ACCOUNT MANAGEMENT'] },
  { name: 'Creditors Relief', aliases: ['CREDITORS RELIEF'] },
  { name: 'DRS / Debt Resolution', aliases: ['DEBT RESOLUTION', 'DEBT RELIEF SERVICES'] },
  { name: 'National Debt Relief', aliases: ['NATIONAL DEBT RELIEF'] },
  { name: 'Business Debt Resolution', aliases: ['BUSINESS DEBT RESOLUTION'] },
  { name: 'Par Funding recovery', aliases: ['PAR FUNDING'] },
  { name: 'Merchant Debt Solutions', aliases: ['MERCHANT DEBT'] },
  { name: 'Grant Phillips Law', aliases: ['GRANT PHILLIPS'] },
  { name: 'Jacovetti Law', aliases: ['JACOVETTI'] },
  { name: 'Berkovitch & Bouskila', aliases: ['BERKOVITCH'] },
  { name: 'Amos Weinberg', aliases: ['AMOS WEINBERG'] },
  { name: 'Steven Zakharyayev', aliases: ['ZAKHARYAYEV'] },
  { name: 'Collection agency', aliases: ['NCO FINANCIAL', 'IC SYSTEM', 'PORTFOLIO RECOVERY', 'MIDLAND CREDIT', 'CAVALRY PORTFOLIO'] },
];

/**
 * Keyword fallbacks. These are weaker than a name match on purpose — a law
 * firm payment is not automatically debt collection, so a keyword hit is
 * reported as "possible" and left for the underwriter to judge.
 */
export const COLLECTION_KEYWORDS: { pattern: string; weight: number }[] = [
  { pattern: 'DEBT RELIEF', weight: 0.85 },
  { pattern: 'DEBT SETTLEMENT', weight: 0.85 },
  { pattern: 'SETTLEMENT GROUP', weight: 0.8 },
  { pattern: 'SETTLEMENT SERVICES', weight: 0.8 },
  { pattern: 'COLLECTION SERVICES', weight: 0.8 },
  { pattern: 'COLLECTIONS', weight: 0.7 },
  { pattern: 'COLLECTION', weight: 0.6 },
  { pattern: 'RESTRUCTURING', weight: 0.7 },
  { pattern: 'WORKOUT', weight: 0.65 },
  { pattern: 'GARNISHMENT', weight: 0.9 },
  { pattern: 'LEVY', weight: 0.85 },
  { pattern: 'JUDGMENT', weight: 0.85 },
  { pattern: 'LIEN', weight: 0.75 },
  { pattern: 'LAW GROUP', weight: 0.45 },
  { pattern: 'LAW FIRM', weight: 0.45 },
  { pattern: 'ATTORNEY', weight: 0.45 },
  { pattern: 'LEGAL PAYMENT', weight: 0.5 },
  { pattern: 'LEGAL SERVICES', weight: 0.4 },
];

export function matchCollection(description: string): DictionaryHit | null {
  const norm = normalize(description);
  for (const c of COLLECTION_COMPANIES) {
    for (const a of c.aliases) {
      if (contains(norm, a)) {
        return {
          code: `collection:${c.name}`,
          label: c.name,
          reason: `${c.name} is a known debt-collection / settlement company`,
          weight: 0.95,
        };
      }
    }
  }
  for (const k of COLLECTION_KEYWORDS) {
    if (contains(norm, k.pattern)) {
      return {
        code: `collection-kw:${k.pattern}`,
        label: 'Possible collection activity',
        reason: `Description contains "${k.pattern}"`,
        weight: k.weight,
      };
    }
  }
  return null;
}

/* ══════════════════ Confidence presentation ══════════════════ */

export type ConfidenceLevel = 'high' | 'likely' | 'possible' | 'review';

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: 'High confidence',
  likely: 'Likely',
  possible: 'Possible',
  review: 'Needs review',
};

/** Turn a 0–1 weight into the four levels the UI shows. */
export function toConfidence(weight: number): ConfidenceLevel {
  if (weight >= 0.85) return 'high';
  if (weight >= 0.7) return 'likely';
  if (weight >= 0.5) return 'possible';
  return 'review';
}
