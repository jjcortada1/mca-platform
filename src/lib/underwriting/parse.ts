/**
 * Bank-statement parsing for the Underwriting scrub.
 *
 * 100% deterministic — regex + column heuristics. There is no AI call and
 * no network request anywhere in this module; the file the user picks is
 * read in the browser and never uploaded.
 *
 * Two entry points:
 *   gridToTransactions()   — a spreadsheet grid (CSV / XLSX / TSV), the
 *                            format every bank offers under "Download
 *                            transactions".
 *   parseStatementText()   — free text pasted out of a PDF statement.
 *
 * Both return the same normalized Transaction shape so the analysis engine
 * doesn't care where the data came from.
 */

export interface Transaction {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Raw bank descriptor, untouched. */
  description: string;
  /** Signed: deposits positive, withdrawals negative. */
  amount: number;
  /** Running balance if the statement provided one. */
  balance: number | null;
  /** Which uploaded file this row came from (for multi-statement runs). */
  source?: string;
}

export interface ColumnMap {
  date: number;
  description: number;
  /** Single signed amount column. */
  amount: number | null;
  /** Split debit/credit columns (both positive in the file). */
  debit: number | null;
  credit: number | null;
  balance: number | null;
  /** A column holding "DEBIT"/"CREDIT" or "Withdrawal"/"Deposit". */
  type: number | null;
}

export interface DetectResult {
  /** Index of the row that holds the headers (−1 when there are none). */
  headerRow: number;
  map: ColumnMap;
  /** Header labels we matched, for display. */
  headers: string[];
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoFrom(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let year = y;
  if (year < 100) year += year > 70 ? 1900 : 2000;
  if (year < 1990 || year > 2100) return null;
  return `${year}-${pad(m)}-${pad(d)}`;
}

/**
 * Parse the date shapes that actually appear on US bank exports.
 * `fallbackYear` fills in for "MM/DD" style rows with no year.
 */
export function parseDate(raw: string, fallbackYear?: number): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;

  // Excel serial number (days since 1899-12-30) — appears when a cell was
  // read raw. Guarded to a sane modern range so amounts never match.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 25000 && serial < 60000) {
      const ms = (serial - 25569) * 86400000;
      const d = new Date(ms);
      return isoFrom(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }

  // ISO: 2026-01-05 or 2026/01/05
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return isoFrom(Number(m[1]), Number(m[2]), Number(m[3]));

  // US: 01/05/2026, 1-5-26, 01/05
  m = s.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?/);
  if (m) {
    const year = m[3] ? Number(m[3]) : (fallbackYear ?? new Date().getFullYear());
    return isoFrom(year, Number(m[1]), Number(m[2]));
  }

  // Jan 5, 2026  /  Jan 5  /  5 Jan 2026
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:[,\s]+(\d{2,4}))?/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toUpperCase()];
    if (mon) {
      const year = m[3] ? Number(m[3]) : (fallbackYear ?? new Date().getFullYear());
      return isoFrom(year, mon, Number(m[2]));
    }
  }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s]?(\d{2,4})?/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toUpperCase()];
    if (mon) {
      const year = m[3] ? Number(m[3]) : (fallbackYear ?? new Date().getFullYear());
      return isoFrom(year, mon, Number(m[1]));
    }
  }
  return null;
}

/**
 * Parse a money cell. Handles $, commas, parentheses-negatives, trailing
 * CR/DR markers, and a leading/trailing minus. Returns null when the cell
 * holds no number at all.
 */
export function parseMoney(raw: string): number | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  let negative = false;

  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/(^|\s)DR$/i.test(s)) { negative = true; }
  if (/(^|\s)CR$/i.test(s)) { negative = false; }
  s = s.replace(/\b(DR|CR)\b/gi, '').trim();
  if (s.startsWith('-') || s.endsWith('-')) { negative = true; }

  s = s.replace(/[^0-9.]/g, '');
  if (!s || s === '.') return null;
  // Guard against multiple decimal points from mangled text.
  const parts = s.split('.');
  if (parts.length > 2) s = `${parts.slice(0, -1).join('')}.${parts[parts.length - 1]}`;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function norm(label: string): string {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const DATE_LABELS = ['date', 'transaction date', 'posted date', 'post date', 'posting date', 'effective date', 'trans date', 'value date', 'date posted'];
const DESC_LABELS = ['description', 'transaction description', 'details', 'memo', 'payee', 'narrative', 'transaction', 'name', 'merchant', 'particulars', 'reference'];
const AMOUNT_LABELS = ['amount', 'transaction amount', 'amt', 'value'];
const DEBIT_LABELS = ['debit', 'withdrawal', 'withdrawals', 'debits', 'money out', 'paid out', 'payment', 'checks and debits', 'withdrawal amount'];
const CREDIT_LABELS = ['credit', 'deposit', 'deposits', 'credits', 'money in', 'paid in', 'deposit amount', 'deposits and credits'];
const BALANCE_LABELS = ['balance', 'running balance', 'ending balance', 'available balance', 'balance after transaction'];
const TYPE_LABELS = ['type', 'transaction type', 'debit credit', 'dr cr', 'cr dr', 'direction'];

function pickColumn(headers: string[], labels: string[]): number | null {
  // Exact label match first, then "contains" as a fallback.
  for (let i = 0; i < headers.length; i++) {
    if (labels.includes(headers[i])) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    if (labels.some((l) => h === l || h.includes(l))) return i;
  }
  return null;
}

/**
 * Find the header row and map the columns we need. Scans the first 15 rows
 * because bank exports routinely open with account/period preamble lines.
 */
export function detectColumns(grid: string[][]): DetectResult | null {
  const limit = Math.min(grid.length, 15);
  for (let r = 0; r < limit; r++) {
    const headers = (grid[r] || []).map(norm);
    if (headers.filter(Boolean).length < 2) continue;

    const date = pickColumn(headers, DATE_LABELS);
    if (date === null) continue;
    const description = pickColumn(headers, DESC_LABELS);
    if (description === null) continue;

    const debit = pickColumn(headers, DEBIT_LABELS);
    const credit = pickColumn(headers, CREDIT_LABELS);
    let amount = pickColumn(headers, AMOUNT_LABELS);
    // Don't let a generic "amount" column double as the debit column.
    if (amount !== null && (amount === debit || amount === credit)) amount = null;
    if (amount === null && debit === null && credit === null) continue;

    const balance = pickColumn(headers, BALANCE_LABELS);
    const type = pickColumn(headers, TYPE_LABELS);
    return {
      headerRow: r,
      headers: (grid[r] || []).map((h) => String(h || '')),
      map: { date, description, amount, debit, credit, balance, type },
    };
  }
  return null;
}

/** Heuristic column detection for files that ship with no header row. */
export function detectColumnsHeaderless(grid: string[][]): DetectResult | null {
  const sample = grid.slice(0, 40).filter((r) => r.some((c) => String(c || '').trim()));
  if (sample.length < 3) return null;
  const width = Math.max(...sample.map((r) => r.length));

  let dateCol = -1;
  let amountCol = -1;
  let descCol = -1;
  let bestDesc = 0;

  for (let c = 0; c < width; c++) {
    let dates = 0;
    let monies = 0;
    let textLen = 0;
    for (const row of sample) {
      const cell = String(row[c] ?? '').trim();
      if (!cell) continue;
      if (parseDate(cell)) dates++;
      else if (parseMoney(cell) !== null && /\d/.test(cell)) monies++;
      if (/[a-z]{3}/i.test(cell)) textLen += cell.length;
    }
    if (dates >= sample.length * 0.6 && dateCol === -1) dateCol = c;
    else if (monies >= sample.length * 0.6 && amountCol === -1) amountCol = c;
    if (textLen > bestDesc) { bestDesc = textLen; descCol = c; }
  }

  if (dateCol === -1 || amountCol === -1 || descCol === -1 || descCol === dateCol) return null;
  return {
    headerRow: -1,
    headers: [],
    map: { date: dateCol, description: descCol, amount: amountCol, debit: null, credit: null, balance: null, type: null },
  };
}

export interface GridParseResult {
  transactions: Transaction[];
  /** Rows skipped because they had no usable date or amount. */
  skipped: number;
  warnings: string[];
}

/**
 * Turn a detected grid into normalized transactions.
 *
 * Sign handling, in priority order:
 *   1. Split debit/credit columns → debit negative, credit positive.
 *   2. A type column saying DEBIT/WITHDRAWAL → negative.
 *   3. The amount column's own sign, when the file uses both signs.
 *   4. All-positive amount column + a balance column → infer from the
 *      balance delta row to row.
 *   5. Nothing else available → fall back to descriptor keywords and warn.
 */
export function gridToTransactions(
  grid: string[][],
  detected: DetectResult,
  opts: { source?: string; fallbackYear?: number } = {},
): GridParseResult {
  const { map, headerRow } = detected;
  const warnings: string[] = [];
  const start = headerRow + 1;

  interface Draft { date: string; description: string; magnitude: number; signed: number | null; balance: number | null }
  const drafts: Draft[] = [];
  let skipped = 0;
  let lastYear = opts.fallbackYear;

  for (let r = start; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!row.some((c) => String(c || '').trim())) continue;

    const date = parseDate(String(row[map.date] ?? ''), lastYear);
    if (!date) { skipped++; continue; }
    lastYear = Number(date.slice(0, 4));

    const description = String(row[map.description] ?? '').trim();
    const balance = map.balance !== null ? parseMoney(String(row[map.balance] ?? '')) : null;

    let signed: number | null = null;
    let magnitude = 0;

    if (map.debit !== null || map.credit !== null) {
      const deb = map.debit !== null ? parseMoney(String(row[map.debit] ?? '')) : null;
      const cred = map.credit !== null ? parseMoney(String(row[map.credit] ?? '')) : null;
      if (deb !== null && deb !== 0) { signed = -Math.abs(deb); magnitude = Math.abs(deb); }
      else if (cred !== null && cred !== 0) { signed = Math.abs(cred); magnitude = Math.abs(cred); }
      else if (map.amount !== null) {
        const amt = parseMoney(String(row[map.amount] ?? ''));
        if (amt !== null && amt !== 0) { magnitude = Math.abs(amt); signed = amt < 0 ? amt : null; }
      }
    } else if (map.amount !== null) {
      const amt = parseMoney(String(row[map.amount] ?? ''));
      if (amt === null || amt === 0) { skipped++; continue; }
      magnitude = Math.abs(amt);
      if (amt < 0) signed = amt;
      if (map.type !== null) {
        const t = norm(String(row[map.type] ?? ''));
        if (/debit|withdraw|dr\b|out|payment/.test(t)) signed = -magnitude;
        else if (/credit|deposit|cr\b|in\b/.test(t)) signed = magnitude;
      }
      // A positive value in a file that also carries negatives is a credit.
      if (signed === null && amt > 0) signed = null; // resolved below
    }

    if (magnitude === 0 && signed === null) { skipped++; continue; }
    drafts.push({ date, description, magnitude, signed, balance });
  }

  // Pass 2 — resolve any rows whose direction is still unknown.
  const unresolved = drafts.filter((d) => d.signed === null);
  if (unresolved.length) {
    const hasNegatives = drafts.some((d) => d.signed !== null && d.signed < 0);
    const haveBalances = drafts.filter((d) => d.balance !== null).length >= drafts.length * 0.8;

    if (hasNegatives) {
      // The file uses signs; anything still unknown was a positive credit.
      for (const d of unresolved) d.signed = d.magnitude;
    } else if (haveBalances) {
      // All-positive amounts: the running balance tells us the direction.
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        if (d.signed !== null || d.balance === null) continue;
        const prev = i > 0 ? drafts[i - 1].balance : null;
        if (prev === null) { d.signed = d.magnitude; continue; }
        d.signed = d.balance < prev ? -d.magnitude : d.magnitude;
      }
      for (const d of drafts) if (d.signed === null) d.signed = d.magnitude;
    } else {
      // Last resort: descriptor keywords, and say so out loud.
      warnings.push(
        'This file lists every amount as a positive number with no debit/credit or balance column, so deposits vs. withdrawals were inferred from the description. Re-export with a balance column for exact results.',
      );
      for (const d of drafts) {
        if (d.signed !== null) continue;
        const t = d.description.toUpperCase();
        const isDebit = /WITHDRAW|DEBIT|PAYMENT|PMT|ACH DB|PURCHASE|FEE|CHECK|POS |TRANSFER OUT|BILL/.test(t);
        d.signed = isDebit ? -d.magnitude : d.magnitude;
      }
    }
  }

  const transactions: Transaction[] = drafts.map((d) => ({
    date: d.date,
    description: d.description,
    amount: d.signed ?? d.magnitude,
    balance: d.balance,
    source: opts.source,
  }));

  return { transactions, skipped, warnings };
}

/* ───────────────── statement text (PDF / paste) ───────────────── */

/**
 * Section headers that tell you the sign of every row beneath them.
 *
 * This is the single most important signal in a PDF statement. Banks
 * almost never print a minus sign — they group the rows into "Deposits
 * and Additions" and "Electronic Withdrawals" and let the heading carry
 * the meaning. Miss that and every withdrawal reads as revenue.
 *
 * Matched only when the header sits alone on its line, so a row like
 * "Total Deposits and Additions   $23,454.00" can't reset the section.
 */
const CREDIT_SECTION_RE =
  /^\s*(deposits?\s*(and|&)\s*(additions?|credits?|other\s+credits?)|electronic\s+deposits?|deposits?\s+and\s+other\s+additions?|credits?|deposits?|additions?|money\s+in|amounts?\s+received)\s*:?\s*$/i;

const DEBIT_SECTION_RE =
  /^\s*(electronic\s+withdrawals?|withdrawals?\s*(and|&)\s*(subtractions?|debits?|other\s+deductions?)|other\s+withdrawals?|checks?\s+(paid|presented)|atm\s*(and|&)\s*debit\s+card\s+withdrawals?|card\s+(purchases?|withdrawals?)|debit\s+card\s+purchases?|fees?(\s*(and|&)\s*(charges?|service\s+charges?))?|service\s+charges?|debits?|withdrawals?|deductions?|money\s+out|amounts?\s+paid)\s*:?\s*$/i;

/** Lines that look like a transaction but are really a subtotal. */
const TOTAL_LINE_RE = /^\s*(sub)?total\b|^\s*(beginning|ending|opening|closing|previous|new)\s+balance\b|^\s*balance\s+(forward|as\s+of)\b/i;

/** A date at the start of a statement row. */
const DATE_PAT = String.raw`\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s+\d{4})?`;
/** A money token: optional $, thousands separators, two decimals. */
const MONEY_PAT = String.raw`\(?-?\$?\s?\d[\d,]*\.\d{2}\)?-?`;

/**
 * A transaction row.
 *
 * Handles the shapes that actually show up:
 *   • one or two leading dates (posted date + effective date)
 *   • a description that may run flush into the amount when the columns
 *     are tight — hence \s* rather than \s+ before the money
 *   • an optional trailing running balance
 */
const TXN_LINE_RE = new RegExp(
  String.raw`^\s*(${DATE_PAT})(?:\s+(?:${DATE_PAT}))?\s+(.*?)\s*(${MONEY_PAT})(?:\s+(${MONEY_PAT}))?\s*$`,
);

/**
 * Pull the statement year out of the header text.
 *
 * PDF rows usually print "03/02" with no year, so the year has to come
 * from the "March 01, 2026 through March 31, 2026" line up top. Takes the
 * most common 4-digit year in the opening lines.
 */
export function inferStatementYear(text: string): number | undefined {
  const head = String(text || '').split(/\r?\n/).slice(0, 40).join(' ');
  const counts = new Map<number, number>();
  const re = /\b(19\d{2}|20\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) {
    const y = Number(m[1]);
    if (y >= 1990 && y <= 2100) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  if (!counts.size) return undefined;
  let best: number | undefined;
  let bestCount = 0;
  for (const [y, c] of counts) {
    if (c > bestCount) { best = y; bestCount = c; }
  }
  return best;
}

interface TextDraft {
  date: string;
  description: string;
  magnitude: number;
  signed: number | null;
  balance: number | null;
  /** Where the sign came from, for the warning logic. */
  basis: 'explicit' | 'section' | null;
}

/**
 * Parse transaction lines out of a PDF statement — either extracted by
 * src/lib/underwriting/pdf.ts or pasted in by hand.
 *
 * Sign resolution, in order of trustworthiness:
 *   1. An explicit minus sign or parentheses on the amount.
 *   2. The section the row sits under ("Electronic Withdrawals").
 *   3. The running balance moving down instead of up.
 *   4. Description keywords — a guess, and it says so.
 *
 * Whenever a running balance is present it also acts as a check: if the
 * balance moved the opposite way from the sign we assigned, the sign is
 * corrected. That self-heals a wrong section guess.
 */
export function parseStatementText(
  text: string,
  opts: { source?: string; fallbackYear?: number } = {},
): GridParseResult {
  const warnings: string[] = [];
  const rawLines = String(text || '').split(/\r?\n/);
  const baseYear = opts.fallbackYear ?? inferStatementYear(text);

  const drafts: TextDraft[] = [];
  let skipped = 0;
  let section: 'credit' | 'debit' | null = null;
  let year = baseYear;
  let prevMonth: number | null = null;

  for (const rawLine of rawLines) {
    const line = rawLine.replace(/\t/g, '   ').trimEnd();
    if (!line.trim()) continue;

    // Section headings carry the sign for everything beneath them.
    if (CREDIT_SECTION_RE.test(line)) { section = 'credit'; continue; }
    if (DEBIT_SECTION_RE.test(line)) { section = 'debit'; continue; }
    if (TOTAL_LINE_RE.test(line)) continue;

    const m = line.match(TXN_LINE_RE);
    if (!m) {
      // A description too long for its column wraps onto the next line.
      if (drafts.length && !/^\s*\d/.test(rawLine) && /^\s{2,}\S/.test(rawLine)) {
        drafts[drafts.length - 1].description += ` ${line.trim()}`;
      } else if (/\d/.test(line)) {
        skipped++;
      }
      continue;
    }

    const dateText = m[1];
    const description = (m[2] || '').trim();
    const firstMoney = m[3];
    const secondMoney = m[4] ?? null;

    // Statements that straddle New Year print 12/28 then 01/03 — roll the
    // year forward when the month jumps backwards.
    const shortDate = dateText.match(/^(\d{1,2})[/-](\d{1,2})(?![/-]\d)/);
    if (shortDate && year !== undefined) {
      const month = Number(shortDate[1]);
      if (prevMonth !== null && prevMonth - month >= 6) year += 1;
      prevMonth = month;
    }

    const date = parseDate(dateText, year);
    if (!date) { skipped++; continue; }
    if (!shortDate) {
      year = Number(date.slice(0, 4));
      prevMonth = Number(date.slice(5, 7));
    }

    const firstValue = parseMoney(firstMoney);
    if (firstValue === null) { skipped++; continue; }
    const balance = secondMoney !== null ? parseMoney(secondMoney) : null;

    const magnitude = Math.abs(firstValue);
    if (magnitude === 0 && !description) { skipped++; continue; }

    // 1. An explicit sign on the amount always wins.
    let signed: number | null = null;
    let basis: TextDraft['basis'] = null;
    const negated = firstValue < 0 || /^\s*\(/.test(firstMoney) || /-\s*$/.test(firstMoney);
    if (negated) { signed = -magnitude; basis = 'explicit'; }
    else if (/^\s*\+/.test(firstMoney)) { signed = magnitude; basis = 'explicit'; }

    // 2. Otherwise the section heading.
    if (signed === null && section) {
      signed = section === 'debit' ? -magnitude : magnitude;
      basis = 'section';
    }

    drafts.push({ date, description, magnitude, signed, balance, basis });
  }

  // 3. Anything still unresolved: read the direction off the balance.
  const haveBalances = drafts.length > 1 && drafts.filter((d) => d.balance !== null).length >= drafts.length * 0.8;
  const unresolved = drafts.filter((d) => d.signed === null);

  if (unresolved.length && haveBalances) {
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      if (d.signed !== null || d.balance === null) continue;
      const prev = i > 0 ? drafts[i - 1].balance : null;
      if (prev === null) continue;
      d.signed = d.balance < prev ? -d.magnitude : d.magnitude;
    }
  }

  // 4. Last resort: guess from the wording, and say that out loud.
  const stillUnresolved = drafts.filter((d) => d.signed === null);
  if (stillUnresolved.length) {
    if (stillUnresolved.length > drafts.length * 0.25) {
      warnings.push(
        'This statement has no minus signs, no deposit/withdrawal sections, and no running balance, so deposits vs. withdrawals were guessed from each description. Check the monthly deposit totals before trusting the grade.',
      );
    }
    for (const d of stillUnresolved) {
      const t = d.description.toUpperCase();
      const isDebit = /WITHDRAW|DEBIT|PAYMENT|PMT|ACH DB|PURCHASE|FEE|CHECK|POS |TRANSFER OUT|BILL|CHARGE/.test(t);
      d.signed = isDebit ? -d.magnitude : d.magnitude;
    }
  }

  // Cross-check every sign against the running balance and correct any
  // that disagree — this catches a mislabeled section or a bad guess.
  if (haveBalances) {
    let corrected = 0;
    for (let i = 1; i < drafts.length; i++) {
      const d = drafts[i];
      const prev = drafts[i - 1].balance;
      if (d.balance === null || prev === null || d.signed === null) continue;
      const delta = d.balance - prev;
      if (Math.abs(delta) < 0.005) continue;
      const asIs = Math.abs(delta - d.signed);
      const flipped = Math.abs(delta + d.signed);
      if (flipped < asIs && flipped <= 0.01) {
        d.signed = -d.signed;
        corrected++;
      }
    }
    if (corrected > 0) {
      warnings.push(
        `${corrected} transaction${corrected === 1 ? '' : 's'} had the deposit/withdrawal direction corrected using the running balance.`,
      );
    }
  }

  const transactions: Transaction[] = drafts.map((d) => ({
    date: d.date,
    description: d.description,
    amount: d.signed ?? d.magnitude,
    balance: d.balance,
    source: opts.source,
  }));
  return { transactions, skipped, warnings };
}


/**
 * Merge transactions from several statements, dropping exact duplicates
 * (the same date + descriptor + amount), which happens when a broker
 * uploads overlapping statement periods.
 */
export function mergeTransactions(sets: Transaction[][]): Transaction[] {
  const seen = new Set<string>();
  const out: Transaction[] = [];
  for (const set of sets) {
    for (const t of set) {
      const key = `${t.date}|${t.description.toUpperCase().replace(/\s+/g, ' ')}|${t.amount.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
