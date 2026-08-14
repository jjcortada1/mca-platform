/**
 * Worksheet formula engine.
 *
 * A small, dependency-free spreadsheet evaluator: `=SUM(A1:A10)*1.35`
 * behaves the way anyone who has used a spreadsheet expects.
 *
 * Scope is deliberate. It covers the arithmetic, references, ranges, and
 * functions people actually reach for, plus a set of MCA functions that
 * turn deal math into one cell instead of a chain of intermediate columns
 * — that is the part a generic spreadsheet can't give a broker.
 *
 * Design notes:
 *  • Values are stored as the RAW text the user typed. A formula cell keeps
 *    its `=...` source forever; only the DISPLAY is computed. Nothing ever
 *    rewrites a cell.
 *  • Circular references return #CYCLE! rather than hanging.
 *  • Errors are spreadsheet-style strings (#REF!, #DIV/0!, #NAME?) so a bad
 *    formula shows up in the cell instead of breaking the grid.
 */

export type CellValue = number | string | boolean | null;

export interface FormulaContext {
  /** Raw text of a cell by A1 reference; null when out of range. */
  getRaw: (col: number, row: number) => string | null;
  /** Column count, for bounds checks. */
  columnCount: number;
  rowCount: number;
}

const ERR = {
  ref: '#REF!',
  div0: '#DIV/0!',
  name: '#NAME?',
  value: '#VALUE!',
  cycle: '#CYCLE!',
  parse: '#ERROR!',
} as const;

export function isFormula(raw: string): boolean {
  return typeof raw === 'string' && raw.trimStart().startsWith('=');
}

export function isErrorValue(v: CellValue): boolean {
  return typeof v === 'string' && Object.values(ERR).includes(v as never);
}

/* ─────────────────────────── A1 references ─────────────────────────── */

/** "AB12" → { col: 27, row: 11 } (both zero-based). */
export function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  if (!row) return null;
  return { col: col - 1, row: row - 1 };
}

export function toRef(col: number, row: number): string {
  let n = col;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${out}${row + 1}`;
}

/* ─────────────────────────── tokenizer ─────────────────────────── */

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; v: string }
  | { t: 'range'; a: string; b: string }
  | { t: 'fn'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' } | { t: 'rp' } | { t: 'comma' };

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  const s = src;

  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }

    if (c === '(') { out.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue; }
    if (c === ',') { out.push({ t: 'comma' }); i++; continue; }

    if (c === '"') {
      let j = i + 1;
      let v = '';
      while (j < s.length && s[j] !== '"') { v += s[j]; j++; }
      if (j >= s.length) return null;
      out.push({ t: 'str', v });
      i = j + 1;
      continue;
    }

    // Multi-char comparison operators first.
    const two = s.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^%&<>='.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }

    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const n = Number(s.slice(i, j));
      if (!Number.isFinite(n)) return null;
      out.push({ t: 'num', v: n });
      i = j;
      continue;
    }

    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_$.]/.test(s[j])) j++;
      const word = s.slice(i, j);

      // Range: A1:B5
      if (s[j] === ':' && parseRef(word)) {
        let k = j + 1;
        while (k < s.length && /[A-Za-z0-9_$]/.test(s[k])) k++;
        const second = s.slice(j + 1, k);
        if (parseRef(second)) {
          out.push({ t: 'range', a: word, b: second });
          i = k;
          continue;
        }
      }
      // Function call
      if (s[j] === '(') { out.push({ t: 'fn', v: word.toUpperCase() }); i = j; continue; }
      // Boolean literals
      if (/^TRUE$/i.test(word)) { out.push({ t: 'num', v: 1 }); i = j; continue; }
      if (/^FALSE$/i.test(word)) { out.push({ t: 'num', v: 0 }); i = j; continue; }
      // Cell reference
      if (parseRef(word)) { out.push({ t: 'ref', v: word }); i = j; continue; }
      // Bare name — a zero-arg function like TODAY handled above; otherwise unknown
      out.push({ t: 'fn', v: word.toUpperCase() });
      i = j;
      continue;
    }

    return null; // unknown character
  }
  return out;
}

/* ─────────────────────────── parser ─────────────────────────── */

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ref'; v: string }
  | { k: 'range'; a: string; b: string }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'neg'; e: Node };

/** Precedence climbing — standard, and small enough to read in one pass. */
function parse(tokens: Token[]): Node | null {
  let pos = 0;
  const peek = () => tokens[pos];

  function parseExpr(minPrec = 0): Node | null {
    let left = parseUnary();
    if (!left) return null;

    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op') break;
      const prec = PREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      pos++;
      const right = parseExpr(prec + 1);
      if (!right) return null;
      left = { k: 'bin', op: t.v, l: left, r: right };
    }
    return left;
  }

  function parseUnary(): Node | null {
    const t = peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      pos++;
      const e = parseUnary();
      if (!e) return null;
      return t.v === '-' ? { k: 'neg', e } : e;
    }
    return parsePrimary();
  }

  function parsePrimary(): Node | null {
    const t = peek();
    if (!t) return null;
    if (t.t === 'num') { pos++; return { k: 'num', v: t.v }; }
    if (t.t === 'str') { pos++; return { k: 'str', v: t.v }; }
    if (t.t === 'ref') { pos++; return { k: 'ref', v: t.v }; }
    if (t.t === 'range') { pos++; return { k: 'range', a: t.a, b: t.b }; }
    if (t.t === 'lp') {
      pos++;
      const e = parseExpr();
      if (!e || peek()?.t !== 'rp') return null;
      pos++;
      return e;
    }
    if (t.t === 'fn') {
      const name = t.v;
      pos++;
      const args: Node[] = [];
      if (peek()?.t === 'lp') {
        pos++;
        if (peek()?.t === 'rp') { pos++; return { k: 'call', name, args }; }
        for (;;) {
          const a = parseExpr();
          if (!a) return null;
          args.push(a);
          const n = peek();
          if (n?.t === 'comma') { pos++; continue; }
          if (n?.t === 'rp') { pos++; break; }
          return null;
        }
      }
      return { k: 'call', name, args };
    }
    return null;
  }

  const PREC: Record<string, number> = {
    '<': 1, '>': 1, '=': 1, '<=': 1, '>=': 1, '<>': 1,
    '&': 2,
    '+': 3, '-': 3,
    '*': 4, '/': 4,
    '^': 5,
  };

  const node = parseExpr();
  return node && pos === tokens.length ? node : null;
}

/* ─────────────────────────── evaluation ─────────────────────────── */

function toNumber(v: CellValue): number | null {
  if (v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Interpret a stored cell's raw text as a value (no formula evaluation). */
function literal(raw: string): CellValue {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t.replace(/[$,\s%]/g, ''));
  if (t !== '' && Number.isFinite(n) && /[0-9]/.test(t)) return n;
  return raw;
}

export interface EvaluateOptions {
  /** Guards against a formula that references itself through others. */
  visiting?: Set<string>;
}

/**
 * Evaluate one cell's raw text.
 *
 * Non-formulas return their literal value. Formulas are parsed and
 * evaluated against `ctx`, resolving referenced cells recursively (which
 * is what makes `=B1*2` work when B1 is itself `=A1+5`).
 */
export function evaluateCell(
  raw: string,
  ctx: FormulaContext,
  opts: EvaluateOptions = {},
): CellValue {
  if (!isFormula(raw)) return literal(raw ?? '');
  const src = raw.trim().slice(1);
  const tokens = tokenize(src);
  if (!tokens) return ERR.parse;
  const ast = parse(tokens);
  if (!ast) return ERR.parse;
  return evalNode(ast, ctx, opts.visiting ?? new Set());
}

function resolveRef(ref: string, ctx: FormulaContext, visiting: Set<string>): CellValue {
  const p = parseRef(ref);
  if (!p) return ERR.ref;
  if (p.col < 0 || p.row < 0 || p.col >= ctx.columnCount || p.row >= ctx.rowCount) return ERR.ref;
  const key = `${p.col}:${p.row}`;
  if (visiting.has(key)) return ERR.cycle;
  const raw = ctx.getRaw(p.col, p.row);
  if (raw === null) return ERR.ref;
  if (!isFormula(raw)) return literal(raw);
  visiting.add(key);
  const v = evaluateCell(raw, ctx, { visiting });
  visiting.delete(key);
  return v;
}

function expandRange(a: string, b: string, ctx: FormulaContext, visiting: Set<string>): CellValue[] {
  const pa = parseRef(a);
  const pb = parseRef(b);
  if (!pa || !pb) return [ERR.ref];
  const out: CellValue[] = [];
  for (let r = Math.min(pa.row, pb.row); r <= Math.max(pa.row, pb.row); r++) {
    for (let c = Math.min(pa.col, pb.col); c <= Math.max(pa.col, pb.col); c++) {
      if (c < 0 || r < 0 || c >= ctx.columnCount || r >= ctx.rowCount) continue;
      out.push(resolveRef(toRef(c, r), ctx, visiting));
    }
  }
  return out;
}

function flatten(nodes: Node[], ctx: FormulaContext, visiting: Set<string>): CellValue[] {
  const out: CellValue[] = [];
  for (const n of nodes) {
    if (n.k === 'range') out.push(...expandRange(n.a, n.b, ctx, visiting));
    else out.push(evalNode(n, ctx, visiting));
  }
  return out;
}

/** Numbers only — text and blanks are skipped, as in a spreadsheet. */
function numbers(values: CellValue[]): number[] | string {
  const out: number[] = [];
  for (const v of values) {
    if (isErrorValue(v)) return v as string;
    if (v === null || v === '') continue;
    if (typeof v === 'string' && Number.isNaN(Number(v.replace(/[$,\s%]/g, '')))) continue;
    const n = toNumber(v);
    if (n !== null) out.push(n);
  }
  return out;
}

function evalNode(n: Node, ctx: FormulaContext, visiting: Set<string>): CellValue {
  switch (n.k) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'ref': return resolveRef(n.v, ctx, visiting);
    case 'range': {
      const vals = expandRange(n.a, n.b, ctx, visiting);
      return vals.length ? vals[0] : null;
    }
    case 'neg': {
      const v = evalNode(n.e, ctx, visiting);
      if (isErrorValue(v)) return v;
      const num = toNumber(v);
      return num === null ? ERR.value : -num;
    }
    case 'bin': {
      const l = evalNode(n.l, ctx, visiting);
      if (isErrorValue(l)) return l;
      const r = evalNode(n.r, ctx, visiting);
      if (isErrorValue(r)) return r;

      if (n.op === '&') return `${l ?? ''}${r ?? ''}`;

      if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
        const ln = toNumber(l);
        const rn = toNumber(r);
        const bothNum = ln !== null && rn !== null && typeof l !== 'string' || (ln !== null && rn !== null);
        const a: number | string = bothNum ? (ln as number) : String(l ?? '');
        const b: number | string = bothNum ? (rn as number) : String(r ?? '');
        switch (n.op) {
          case '=': return a === b;
          case '<>': return a !== b;
          case '<': return a < b;
          case '>': return a > b;
          case '<=': return a <= b;
          default: return a >= b;
        }
      }

      const ln = toNumber(l);
      const rn = toNumber(r);
      if (ln === null || rn === null) return ERR.value;
      switch (n.op) {
        case '+': return ln + rn;
        case '-': return ln - rn;
        case '*': return ln * rn;
        case '/': return rn === 0 ? ERR.div0 : ln / rn;
        case '^': return Math.pow(ln, rn);
        case '%': return ln / 100;
        default: return ERR.parse;
      }
    }
    case 'call': return callFunction(n, ctx, visiting);
    default: return ERR.parse;
  }
}

function callFunction(n: Extract<Node, { k: 'call' }>, ctx: FormulaContext, visiting: Set<string>): CellValue {
  const name = n.name;

  // IF short-circuits, so it must not pre-evaluate every branch.
  if (name === 'IF') {
    if (n.args.length < 2) return ERR.value;
    const cond = evalNode(n.args[0], ctx, visiting);
    if (isErrorValue(cond)) return cond;
    const truthy = typeof cond === 'boolean' ? cond : (toNumber(cond) ?? 0) !== 0;
    if (truthy) return evalNode(n.args[1], ctx, visiting);
    return n.args[2] ? evalNode(n.args[2], ctx, visiting) : false;
  }

  const vals = flatten(n.args, ctx, visiting);
  const firstErr = vals.find(isErrorValue);
  if (firstErr) return firstErr;
  const nums = numbers(vals);
  if (typeof nums === 'string') return nums;
  const arg = (i: number): number | null => (vals[i] === undefined ? null : toNumber(vals[i]));

  switch (name) {
    /* ── arithmetic ── */
    case 'SUM': return nums.reduce((a, b) => a + b, 0);
    case 'PRODUCT': return nums.length ? nums.reduce((a, b) => a * b, 1) : 0;
    case 'AVERAGE': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : ERR.div0;
    case 'MIN': return nums.length ? Math.min(...nums) : 0;
    case 'MAX': return nums.length ? Math.max(...nums) : 0;
    case 'COUNT': return nums.length;
    case 'COUNTA': return vals.filter((v) => v !== null && v !== '').length;
    case 'ABS': { const a = arg(0); return a === null ? ERR.value : Math.abs(a); }
    case 'ROUND': {
      const a = arg(0); const d = arg(1) ?? 0;
      if (a === null) return ERR.value;
      const f = Math.pow(10, d);
      return Math.round(a * f) / f;
    }
    case 'ROUNDUP': { const a = arg(0); const d = arg(1) ?? 0; if (a === null) return ERR.value; const f = Math.pow(10, d); return Math.ceil(a * f) / f; }
    case 'ROUNDDOWN': { const a = arg(0); const d = arg(1) ?? 0; if (a === null) return ERR.value; const f = Math.pow(10, d); return Math.floor(a * f) / f; }
    case 'SQRT': { const a = arg(0); return a === null ? ERR.value : Math.sqrt(a); }
    case 'POWER': { const a = arg(0); const b = arg(1); return a === null || b === null ? ERR.value : Math.pow(a, b); }

    /* ── logic ── */
    case 'AND': return vals.every((v) => (typeof v === 'boolean' ? v : (toNumber(v) ?? 0) !== 0));
    case 'OR': return vals.some((v) => (typeof v === 'boolean' ? v : (toNumber(v) ?? 0) !== 0));
    case 'NOT': { const v = vals[0]; return !(typeof v === 'boolean' ? v : (toNumber(v) ?? 0) !== 0); }

    /* ── text ── */
    case 'CONCAT':
    case 'CONCATENATE': return vals.map((v) => (v === null ? '' : String(v))).join('');
    case 'LEN': return String(vals[0] ?? '').length;
    case 'UPPER': return String(vals[0] ?? '').toUpperCase();
    case 'LOWER': return String(vals[0] ?? '').toLowerCase();
    case 'TRIM': return String(vals[0] ?? '').trim();

    /* ══════════════════ MCA functions ══════════════════
       The reason this engine exists rather than a generic one. Deal math
       that would otherwise need four helper columns fits in one cell. */

    /** PAYBACK(funding, factor) — total the merchant repays. */
    case 'PAYBACK': {
      const f = arg(0); const r = arg(1);
      return f === null || r === null ? ERR.value : f * r;
    }
    /** FACTOR(funding, payback) — the factor rate implied by both figures. */
    case 'FACTOR': {
      const f = arg(0); const p = arg(1);
      if (f === null || p === null) return ERR.value;
      return f === 0 ? ERR.div0 : p / f;
    }
    /** PAYMENT(payback, termCount) — per-payment amount over the term. */
    case 'PAYMENT': {
      const p = arg(0); const t = arg(1);
      if (p === null || t === null) return ERR.value;
      return t === 0 ? ERR.div0 : p / t;
    }
    /** NETFUNDING(funding, feePct) — what actually hits the account. */
    case 'NETFUNDING': {
      const f = arg(0); const fee = arg(1) ?? 0;
      if (f === null) return ERR.value;
      return f - f * (fee > 1 ? fee / 100 : fee);
    }
    /** COMMISSION(funding, pct) — commission dollars. */
    case 'COMMISSION': {
      const f = arg(0); const pct = arg(1);
      if (f === null || pct === null) return ERR.value;
      return f * (pct > 1 ? pct / 100 : pct);
    }
    /** HOLDBACK(payment, monthlyRevenue) — withhold as a share of revenue. */
    case 'HOLDBACK': {
      const pay = arg(0); const rev = arg(1);
      if (pay === null || rev === null) return ERR.value;
      return rev === 0 ? ERR.div0 : pay / rev;
    }
    /** TERMDAYS(payback, dailyPayment) — business days to pay off. */
    case 'TERMDAYS': {
      const p = arg(0); const d = arg(1);
      if (p === null || d === null) return ERR.value;
      return d === 0 ? ERR.div0 : Math.ceil(p / d);
    }
    /** TERMWEEKS(payback, weeklyPayment) */
    case 'TERMWEEKS': {
      const p = arg(0); const w = arg(1);
      if (p === null || w === null) return ERR.value;
      return w === 0 ? ERR.div0 : Math.ceil(p / w);
    }
    /** BALANCE(payback, paymentsMade, paymentAmount) — remaining balance. */
    case 'BALANCE': {
      const p = arg(0); const made = arg(1); const amt = arg(2);
      if (p === null || made === null || amt === null) return ERR.value;
      return Math.max(0, p - made * amt);
    }

    default: return ERR.name;
  }
}

/** Every function name, for the in-app help and autocomplete. */
export const FUNCTION_HELP: { name: string; sig: string; about: string; mca?: boolean }[] = [
  { name: 'SUM', sig: 'SUM(A1:A10)', about: 'Adds numbers or a range.' },
  { name: 'AVERAGE', sig: 'AVERAGE(A1:A10)', about: 'Mean of the numbers.' },
  { name: 'MIN', sig: 'MIN(A1:A10)', about: 'Smallest number.' },
  { name: 'MAX', sig: 'MAX(A1:A10)', about: 'Largest number.' },
  { name: 'COUNT', sig: 'COUNT(A1:A10)', about: 'How many numbers.' },
  { name: 'COUNTA', sig: 'COUNTA(A1:A10)', about: 'How many non-empty cells.' },
  { name: 'ROUND', sig: 'ROUND(A1, 2)', about: 'Round to N decimals.' },
  { name: 'IF', sig: 'IF(A1>100, "yes", "no")', about: 'Conditional value.' },
  { name: 'CONCAT', sig: 'CONCAT(A1, " ", B1)', about: 'Join text.' },
  { name: 'ABS', sig: 'ABS(A1)', about: 'Absolute value.' },
  { name: 'PAYBACK', sig: 'PAYBACK(funding, factor)', about: 'Total repaid = funding × factor.', mca: true },
  { name: 'FACTOR', sig: 'FACTOR(funding, payback)', about: 'Factor rate implied by both figures.', mca: true },
  { name: 'PAYMENT', sig: 'PAYMENT(payback, terms)', about: 'Per-payment amount over the term.', mca: true },
  { name: 'NETFUNDING', sig: 'NETFUNDING(funding, fee%)', about: 'What actually hits the account after fees.', mca: true },
  { name: 'COMMISSION', sig: 'COMMISSION(funding, pct)', about: 'Commission dollars.', mca: true },
  { name: 'HOLDBACK', sig: 'HOLDBACK(payment, revenue)', about: 'Withhold as a share of revenue.', mca: true },
  { name: 'TERMDAYS', sig: 'TERMDAYS(payback, daily)', about: 'Business days to pay off.', mca: true },
  { name: 'TERMWEEKS', sig: 'TERMWEEKS(payback, weekly)', about: 'Weeks to pay off.', mca: true },
  { name: 'BALANCE', sig: 'BALANCE(payback, made, amount)', about: 'Remaining balance after N payments.', mca: true },
];

/** Format a computed value for display in a cell. */
export function formatValue(v: CellValue): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ERR.value;
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  }
  return v;
}
