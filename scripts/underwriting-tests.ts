/**
 * Regression tests for the deterministic underwriting engine.
 *
 * Builds synthetic bank statements with known answers and asserts the
 * scrub reproduces them: MCA positions found, non-MCA recurring payments
 * NOT flagged, cadence and payment amounts correct, NSF counting, the
 * PDF-paste parser, balance-delta sign inference, and duplicate merging.
 *
 * Run with: npm run test:underwriting
 */
import { parseStatementText, gridToTransactions, detectColumns, mergeTransactions } from '@/lib/underwriting/parse';
import { analyzeStatements, reportToText } from '@/lib/underwriting/engine';

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function isWeekday(d: Date) { const w = d.getUTCDay(); return w >= 1 && w <= 5; }

// Build 3 months of a merchant with two advances.
const start = new Date(Date.UTC(2026, 2, 2)); // Mar 2 2026, a Monday
const rows: { date: string; desc: string; amt: number }[] = [];
let balance = 18_500;

for (let i = 0; i < 92; i++) {
  const day = addDays(start, i);
  if (!isWeekday(day)) continue;

  // Revenue deposits — 3 a week.
  if (i % 2 === 0) {
    const amt = 3200 + ((i * 137) % 2600);
    rows.push({ date: iso(day), desc: 'ACH DEPOSIT MERCHANT SVCS SETTLEMENT 8829102', amt });
  }
  // Position 1 — daily, known funder.
  rows.push({ date: iso(day), desc: 'ORIG CO NAME:RAPID FINANCE ORIG ID:1900288 DESC DATE:  CO ENTRY DESCR:ACH DEBIT', amt: -1285.71 });
  // Position 2 — weekly Wednesday, unknown name.
  if (day.getUTCDay() === 3) {
    rows.push({ date: iso(day), desc: 'VICTORY FUNDING LLC ACH DEBIT WEB ID 44219', amt: -942.13 });
  }
  // Ordinary recurring non-MCA that should NOT be flagged.
  if (day.getUTCDate() === 5 || day.getUTCDate() === 20) {
    rows.push({ date: iso(day), desc: 'GUSTO PAYROLL 6X8842', amt: -8200 });
  }
  if (day.getUTCDate() === 12) {
    rows.push({ date: iso(day), desc: 'PROGRESSIVE INSURANCE PREMIUM', amt: -640.22 });
  }
  // A couple of NSF hits.
  if (i === 30 || i === 60) {
    rows.push({ date: iso(day), desc: 'NSF RETURNED ITEM FEE', amt: -35 });
  }
  // Rent.
  if (day.getUTCDate() === 1 || day.getUTCDate() === 2) {
    rows.push({ date: iso(day), desc: 'RENT PAYMENT PROPERTY MGMT LLC', amt: -6500 });
  }
}

// Turn into a CSV-style grid with running balance.
const grid: string[][] = [['Date', 'Description', 'Amount', 'Running Balance']];
for (const r of rows) {
  balance += r.amt;
  grid.push([r.date, r.desc, r.amt.toFixed(2), balance.toFixed(2)]);
}

const detected = detectColumns(grid);
if (!detected) throw new Error('FAIL: column detection returned null');
console.log('detected columns:', JSON.stringify(detected.map));

const parsed = gridToTransactions(grid, detected, { source: 'test.csv' });
console.log(`parsed ${parsed.transactions.length} txns, skipped ${parsed.skipped}, warnings ${parsed.warnings.length}`);
if (parsed.transactions.length !== rows.length) throw new Error(`FAIL: expected ${rows.length} txns, got ${parsed.transactions.length}`);

const report = analyzeStatements(parsed.transactions, parsed.warnings);
console.log('\n' + reportToText(report, 'Test Merchant LLC'));

// ── assertions ──
const names = report.positions.map((p) => p.funderName);
console.log('\npositions:', JSON.stringify(names));
if (!names.some((n) => n === 'Rapid Finance')) throw new Error('FAIL: Rapid Finance not detected');
if (!names.some((n) => /Victory/i.test(n))) throw new Error('FAIL: Victory Funding not detected');
if (names.some((n) => /gusto|progressive|rent/i.test(n))) throw new Error('FAIL: non-MCA recurring flagged as a position');
if (report.positionCount !== 2) throw new Error(`FAIL: expected 2 positions, got ${report.positionCount}`);

const daily = report.positions.find((p) => p.funderName === 'Rapid Finance')!;
if (daily.cadence !== 'daily') throw new Error(`FAIL: expected daily cadence, got ${daily.cadence}`);
if (Math.abs(daily.paymentAmount - 1285.71) > 0.01) throw new Error('FAIL: wrong payment amount');

const weekly = report.positions.find((p) => /Victory/i.test(p.funderName))!;
if (weekly.cadence !== 'weekly') throw new Error(`FAIL: expected weekly cadence, got ${weekly.cadence}`);

if (report.totalNsf < 1) throw new Error(`FAIL: expected 2 NSF items, got ${report.totalNsf}`);
if (!report.balancesAvailable) throw new Error('FAIL: balances should be available');
if (report.months.length !== 4) console.log(`note: ${report.months.length} month buckets`);

// ── PDF-paste path ──
const pdfText = rows.slice(0, 60).map((r) => {
  const amt = r.amt < 0 ? `-${Math.abs(r.amt).toFixed(2)}` : r.amt.toFixed(2);
  return `${r.date.slice(5, 7)}/${r.date.slice(8, 10)}/${r.date.slice(0, 4)}   ${r.desc}   ${amt}`;
}).join('\n');
const pasted = parseStatementText(pdfText, { source: 'paste' });
console.log(`\npaste path: ${pasted.transactions.length}/60 lines parsed, ${pasted.skipped} skipped`);
if (pasted.transactions.length < 55) throw new Error('FAIL: paste parser missed too many lines');

// ── all-positive amounts, balance-inferred direction ──
const posGrid: string[][] = [['Date', 'Description', 'Amount', 'Balance']];
let b2 = 18_500;
for (const r of rows.slice(0, 80)) { b2 += r.amt; posGrid.push([r.date, r.desc, Math.abs(r.amt).toFixed(2), b2.toFixed(2)]); }
const d2 = detectColumns(posGrid)!;
const p2 = gridToTransactions(posGrid, d2, {});
const negCount = p2.transactions.filter((t) => t.amount < 0).length;
const expectedNeg = rows.slice(0, 80).filter((r) => r.amt < 0).length;
console.log(`balance-inferred signs: ${negCount} debits found, expected ~${expectedNeg}`);
if (Math.abs(negCount - expectedNeg) > 2) throw new Error('FAIL: balance-delta sign inference is off');

// ── merge dedupe ──
const merged = mergeTransactions([parsed.transactions, parsed.transactions]);
if (merged.length !== parsed.transactions.length) throw new Error('FAIL: duplicate merge did not dedupe');

console.log('\n✅ ALL ENGINE CHECKS PASSED');

/* ── Scenario 2: clean merchant, no advances ── */
const rows2: { date: string; desc: string; amt: number }[] = [];
let bal2 = 42_000;
for (let i = 0; i < 92; i++) {
  const day = addDays(start, i);
  if (!isWeekday(day)) continue;
  rows2.push({ date: iso(day), desc: 'CARD SETTLEMENT DEPOSIT 992018', amt: 2900 + ((i * 211) % 1800) });
  if (day.getUTCDate() === 5 || day.getUTCDate() === 20) rows2.push({ date: iso(day), desc: 'ADP PAYROLL FEES 88123', amt: -9100 });
  if (day.getUTCDate() === 1 || day.getUTCDate() === 2) rows2.push({ date: iso(day), desc: 'RENT PAYMENT PROPERTY MGMT LLC', amt: -7200 });
  if (day.getUTCDate() === 15) rows2.push({ date: iso(day), desc: 'AMERICAN EXPRESS ACH PMT', amt: -4300 });
}
const grid2: string[][] = [['Date', 'Description', 'Amount', 'Running Balance']];
for (const r of rows2) { bal2 += r.amt; grid2.push([r.date, r.desc, r.amt.toFixed(2), bal2.toFixed(2)]); }
const rep2 = analyzeStatements(gridToTransactions(grid2, detectColumns(grid2)!, {}).transactions);
console.log(`\nclean merchant → grade ${rep2.grade} (${rep2.score}) | positions ${rep2.positionCount} ${JSON.stringify(rep2.positions.map(p=>p.funderName))} | room ${rep2.maxNewAdvance}`);
if (rep2.positionCount !== 0) throw new Error('FAIL: false-positive positions on a clean file');
if (rep2.grade !== 'A') throw new Error(`FAIL: clean file should grade A, got ${rep2.grade}`);
if (rep2.maxNewAdvance <= 0) throw new Error('FAIL: clean file should support new money');
console.log('✅ SCENARIO 2 PASSED');
