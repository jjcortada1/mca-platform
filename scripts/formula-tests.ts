/**
 * Formula engine tests — arithmetic, references, ranges, errors, cycles,
 * and the MCA functions that are the point of having our own engine.
 */
import { evaluateCell, formatValue, parseRef, toRef, isFormula } from '@/lib/worksheets/formula';
import type { FormulaContext } from '@/lib/worksheets/formula';

// A tiny sheet:  A       B        C
//        row1    100     1.35     =A1*B1
//        row2    200     =A1+A2   =SUM(A1:A2)
const cells: string[][] = [
  ['100', '1.35', '=A1*B1'],
  ['200', '=A1+A2', '=SUM(A1:A2)'],
  ['abc', '', '=A3'],
];
const ctx: FormulaContext = {
  getRaw: (c, r) => (cells[r]?.[c] ?? null),
  columnCount: 3,
  rowCount: 3,
};
const ev = (src: string) => formatValue(evaluateCell(src, ctx));

function eq(got: string, want: string, label: string) {
  if (got !== want) throw new Error(`FAIL(${label}): expected ${want}, got ${got}`);
}

// References + arithmetic
eq(ev('=A1'), '100', 'ref');
eq(ev('=A1+A2'), '300', 'add');
eq(ev('=A1*B1'), '135', 'multiply');
eq(ev('=(A1+A2)/3'), '100', 'parens');
eq(ev('=A1*2^2'), '400', 'power precedence');
eq(ev('=-A1+50'), '-50', 'unary minus');

// Formulas that reference other formulas.
eq(ev('=C1'), '135', 'formula referencing a formula');
eq(ev('=B2*2'), '600', 'nested formula');

// Ranges + functions
eq(ev('=SUM(A1:A2)'), '300', 'SUM range');
eq(ev('=AVERAGE(A1:A2)'), '150', 'AVERAGE');
eq(ev('=MAX(A1:A2)'), '200', 'MAX');
eq(ev('=COUNT(A1:A3)'), '2', 'COUNT skips text');
eq(ev('=COUNTA(A1:A3)'), '3', 'COUNTA counts text');
eq(ev('=ROUND(A1/3, 2)'), '33.33', 'ROUND');
eq(ev('=IF(A1>50, "big", "small")'), 'big', 'IF true');
eq(ev('=IF(A1>500, "big", "small")'), 'small', 'IF false');
eq(ev('=CONCAT("Deal ", A1)'), 'Deal 100', 'CONCAT');

// Text + currency inputs shouldn't break arithmetic.
eq(formatValue(evaluateCell('=SUM(A1:A2)*1.35', ctx)), '405', 'range * literal');

// Errors are spreadsheet-style, not exceptions.
eq(ev('=A1/0'), '#DIV/0!', 'divide by zero');
eq(ev('=NOPE(1)'), '#NAME?', 'unknown function');
eq(ev('=A99'), '#REF!', 'out of range ref');
eq(ev('=1+'), '#ERROR!', 'parse error');

// A self-referencing formula must not hang.
const cyc: string[][] = [['=B1', '=A1']];
const cycCtx: FormulaContext = { getRaw: (c, r) => (cyc[r]?.[c] ?? null), columnCount: 2, rowCount: 1 };
const cycOut = formatValue(evaluateCell('=A1', cycCtx));
if (cycOut !== '#CYCLE!') throw new Error(`FAIL(cycle): expected #CYCLE!, got ${cycOut}`);

// Non-formulas pass through untouched.
if (isFormula('hello')) throw new Error('FAIL: plain text treated as a formula');
eq(formatValue(evaluateCell('hello', ctx)), 'hello', 'literal text');
eq(formatValue(evaluateCell('42', ctx)), '42', 'literal number');

// A1 reference helpers round-trip.
if (toRef(0, 0) !== 'A1') throw new Error('FAIL: toRef A1');
if (toRef(26, 4) !== 'AA5') throw new Error(`FAIL: toRef AA5, got ${toRef(26, 4)}`);
const p = parseRef('AA5')!;
if (p.col !== 26 || p.row !== 4) throw new Error('FAIL: parseRef AA5');

/* ── The MCA functions ── */
eq(ev('=PAYBACK(100000, 1.35)'), '135000', 'PAYBACK');
eq(ev('=FACTOR(100000, 135000)'), '1.35', 'FACTOR');
eq(ev('=PAYMENT(135000, 100)'), '1350', 'PAYMENT');
eq(ev('=NETFUNDING(100000, 10)'), '90000', 'NETFUNDING with whole percent');
eq(ev('=NETFUNDING(100000, 0.1)'), '90000', 'NETFUNDING with decimal fraction');
eq(ev('=COMMISSION(100000, 12)'), '12000', 'COMMISSION');
eq(ev('=TERMDAYS(135000, 1350)'), '100', 'TERMDAYS');
eq(ev('=TERMWEEKS(135000, 6750)'), '20', 'TERMWEEKS');
eq(ev('=BALANCE(135000, 40, 1350)'), '81000', 'BALANCE');
eq(ev('=ROUND(HOLDBACK(27000, 150000)*100, 1)'), '18', 'HOLDBACK as a percentage');
// Overpaid balance floors at zero rather than going negative.
eq(ev('=BALANCE(135000, 200, 1350)'), '0', 'BALANCE floors at zero');
// A full deal chained from cells, the way a broker would build a row.
eq(ev('=ROUND(PAYMENT(PAYBACK(A1, B1), 10), 2)'), '13.5', 'chained MCA functions');

console.log('✅ ALL FORMULA TESTS PASSED');
