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
import { parseStatementText, gridToTransactions, detectColumns, mergeTransactions, inferStatementYear } from '@/lib/underwriting/parse';
import { groupTextItemsIntoLines } from '@/lib/underwriting/pdf';
import { buildUnderwritingFile, toDealCriteria } from '@/lib/underwriting/workstation';
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

/* ═══════════════ Scenario 3: real PDF, end to end ═══════════════ */

/**
 * Builds an actual PDF (Chase-style: no minus signs, sign carried by
 * "DEPOSITS AND ADDITIONS" / "ELECTRONIC WITHDRAWALS" headings, dates with
 * no year), runs it through pdf.js + the line rebuilder + the parser, and
 * checks the scrub gets the same answer a human reading the page would.
 */
function buildStatementPdf(opts: {
  header: string[];
  sections: { title: string; rows: [string, string, string][] }[];
  withBalance?: boolean;
}): Uint8Array {
  // Real statements run to several pages, and a page break must not lose
  // rows or reset the section context — so the fixture paginates too, and
  // repeats the section heading on each continuation page like banks do.
  const pages: { x: number; y: number; size: number; text: string; bold: boolean }[][] = [];
  let frags: { x: number; y: number; size: number; text: string; bold: boolean }[] = [];
  let y = 740;
  const BOTTOM = 60;

  const newPage = () => { pages.push(frags); frags = []; y = 740; };
  const put = (cells: [number, string][], size = 9, bold = false) => {
    for (const [x, text] of cells) frags.push({ x, y, size, text, bold });
    y -= 13;
  };
  const colHeader = () => put(
    opts.withBalance
      ? [[54, 'DATE'], [110, 'DESCRIPTION'], [470, 'AMOUNT'], [530, 'BALANCE']]
      : [[54, 'DATE'], [110, 'DESCRIPTION'], [500, 'AMOUNT']],
    8, true,
  );

  for (const h of opts.header) put([[54, h]], 9);
  y -= 13;

  for (const sec of opts.sections) {
    if (y < BOTTOM + 40) newPage();
    put([[54, sec.title]], 10, true);
    colHeader();
    for (const [d, desc, amt] of sec.rows) {
      if (y < BOTTOM) {
        newPage();
        put([[54, `${sec.title} (continued)`]], 10, true);
        colHeader();
      }
      if (opts.withBalance) {
        const [a, b] = amt.split('|');
        put([[54, d], [110, desc.slice(0, 80)], [470, a], [530, b]]);
      } else {
        put([[54, d], [110, desc.slice(0, 88)], [500, amt]]);
      }
    }
    y -= 13;
  }
  pages.push(frags);

  const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objs: string[] = [];
  // 1 catalog, 2 pages tree, then per page: page obj + content obj, then fonts.
  const pageObjIds: number[] = [];
  let next = 3;
  const contents: { id: number; body: string }[] = [];
  for (const pageFrags of pages) {
    const pageId = next++;
    const contentId = next++;
    pageObjIds.push(pageId);
    let content = '';
    for (const f of pageFrags) {
      content += `BT /${f.bold ? 'F2' : 'F1'} ${f.size} Tf 1 0 0 1 ${f.x} ${f.y} Tm (${esc(f.text)}) Tj ET\n`;
    }
    contents.push({ id: contentId, body: content });
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 FONT1 0 R /F2 FONT2 0 R >> >> /Contents ${contentId} 0 R >>`;
  }
  const font1 = next++;
  const font2 = next++;
  for (const id of pageObjIds) {
    objs[id] = objs[id].replace('FONT1', String(font1)).replace('FONT2', String(font2));
  }
  for (const c of contents) {
    objs[c.id] = `<< /Length ${Buffer.byteLength(c.body)} >>\nstream\n${c.body}endstream`;
  }
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageObjIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`;
  objs[font1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[font2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < next; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let i = 1; i < next; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise;
  const lines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it: any) => typeof it.str === 'string')
      .map((it: any) => ({
        str: it.str, x: it.transform[4], y: it.transform[5],
        width: it.width ?? 0, height: it.height ?? 10,
      }));
    lines.push(...groupTextItemsIntoLines(items));
  }
  return lines.join('\n');
}

async function runPdfScenarios() {
  /* — Chase style: no signs anywhere, sections carry the direction — */
  const depositRows: [string, string, string][] = [];
  const withdrawalRows: [string, string, string][] = [];
  for (let i = 0; i < 92; i++) {
    const day = addDays(start, i);
    if (!isWeekday(day)) continue;
    const md = `${iso(day).slice(5, 7)}/${iso(day).slice(8, 10)}`;
    if (i % 2 === 0) depositRows.push([md, `Orig CO Name:Merchant Svcs Settlement Orig ID:9982911 Descr:DEPOSIT`, (3200 + ((i * 137) % 2600)).toFixed(2)]);
    withdrawalRows.push([md, 'Orig CO Name:Rapid Finance Orig ID:1900288 Descr:ACH DEBIT', '1,285.71']);
    if (day.getUTCDay() === 3) withdrawalRows.push([md, 'Orig CO Name:Victory Funding LLC Orig ID:4421900 Descr:ACH DEBIT', '942.13']);
    if (day.getUTCDate() === 5 || day.getUTCDate() === 20) withdrawalRows.push([md, 'Orig CO Name:Gusto Payroll Orig ID:6X88420 Descr:PAYROLL', '8,200.00']);
  }

  const pdfBytes = buildStatementPdf({
    header: [
      'CHASE BUSINESS COMPLETE CHECKING',
      'ACME LOGISTICS LLC',
      'Account Number: 000000123456789',
      'March 02, 2026 through June 01, 2026',
    ],
    sections: [
      { title: 'DEPOSITS AND ADDITIONS', rows: depositRows },
      { title: 'ELECTRONIC WITHDRAWALS', rows: withdrawalRows },
      { title: 'FEES', rows: [['03/31', 'NSF Returned Item Fee', '35.00']] },
    ],
  });

  const text = await pdfToText(pdfBytes);
  const year = inferStatementYear(text);
  if (year !== 2026) throw new Error(`FAIL(pdf): statement year should be 2026, got ${year}`);

  const parsed = parseStatementText(text, { source: 'chase.pdf' });
  const deposits = parsed.transactions.filter((t) => t.amount > 0);
  const debits = parsed.transactions.filter((t) => t.amount < 0);
  console.log(`\npdf → ${parsed.transactions.length} txns (${deposits.length} deposits, ${debits.length} debits), ${parsed.skipped} lines skipped`);

  if (deposits.length !== depositRows.length) throw new Error(`FAIL(pdf): expected ${depositRows.length} deposits, got ${deposits.length}`);
  if (debits.length !== withdrawalRows.length + 1) throw new Error(`FAIL(pdf): expected ${withdrawalRows.length + 1} debits, got ${debits.length}`);

  const rep = analyzeStatements(parsed.transactions, parsed.warnings);
  const pdfNames = rep.positions.map((p) => p.funderName);
  console.log(`pdf → grade ${rep.grade} (${rep.score}) | positions ${JSON.stringify(pdfNames)} | NSF ${rep.totalNsf}`);
  if (!pdfNames.includes('Rapid Finance')) throw new Error('FAIL(pdf): Rapid Finance not detected');
  if (!pdfNames.some((n) => /Victory/i.test(n))) throw new Error('FAIL(pdf): Victory Funding not detected');
  if (pdfNames.some((n) => /gusto/i.test(n))) throw new Error('FAIL(pdf): payroll flagged as an advance');
  if (rep.totalNsf !== 1) throw new Error(`FAIL(pdf): expected 1 NSF item, got ${rep.totalNsf}`);
  const rapid = rep.positions.find((p) => p.funderName === 'Rapid Finance')!;
  if (rapid.cadence !== 'daily') throw new Error(`FAIL(pdf): expected daily cadence, got ${rapid.cadence}`);
  console.log('✅ SCENARIO 3 (PDF, section-signed) PASSED');

  /* — A layout with a running balance and NO sections: the balance
       cross-check has to work out every direction on its own. — */
  const mixedRows: [string, string, string][] = [];
  let running = 25_000;
  for (let i = 0; i < 40; i++) {
    const day = addDays(start, i);
    if (!isWeekday(day)) continue;
    const md = `${iso(day).slice(5, 7)}/${iso(day).slice(8, 10)}`;
    const dep = 3000 + ((i * 97) % 1500);
    running += dep;
    mixedRows.push([md, 'CARD SETTLEMENT DEPOSIT 992018', `${dep.toFixed(2)}|${running.toFixed(2)}`]);
    running -= 1285.71;
    mixedRows.push([md, 'RAPID FINANCE ACH DEBIT 1900288', `1,285.71|${running.toFixed(2)}`]);
  }
  const pdf2 = buildStatementPdf({
    header: ['WELLS FARGO BUSINESS CHOICE CHECKING', 'Statement period March 2, 2026 - April 30, 2026'],
    sections: [{ title: 'TRANSACTION HISTORY', rows: mixedRows }],
    withBalance: true,
  });
  const text2 = await pdfToText(pdf2);
  const parsed2 = parseStatementText(text2, { source: 'wells.pdf' });
  const dep2 = parsed2.transactions.filter((t) => t.amount > 0).length;
  const deb2 = parsed2.transactions.filter((t) => t.amount < 0).length;
  console.log(`pdf (balance-only) → ${parsed2.transactions.length} txns: ${dep2} deposits / ${deb2} debits`);
  if (Math.abs(dep2 - deb2) > 1) throw new Error(`FAIL(pdf2): directions unbalanced — ${dep2} deposits vs ${deb2} debits`);
  const rep2b = analyzeStatements(parsed2.transactions, parsed2.warnings);
  if (!rep2b.positions.some((p) => p.funderName === 'Rapid Finance')) {
    throw new Error('FAIL(pdf2): Rapid Finance not detected from the balance-only layout');
  }
  console.log('✅ SCENARIO 4 (PDF, balance-inferred) PASSED');
}

/* ═══════ Scenario 5: payment switch, stacking, funding received ═══════ */

/**
 * The cases the naive version got wrong:
 *   • A funder that re-sets the daily debit partway through is ONE
 *     position whose payment changed — not two positions.
 *   • Two advances from the SAME funder running at the same time are two
 *     positions, even though the descriptor is identical.
 *   • A large deposit from a funder is a funding received, not revenue,
 *     and it pins down when that advance started.
 */
const rows5: { date: string; desc: string; amt: number }[] = [];
let bal5 = 30_000;
for (let i = 0; i < 92; i++) {
  const day = addDays(start, i);
  if (!isWeekday(day)) continue;
  rows5.push({ date: iso(day), desc: 'CARD SETTLEMENT DEPOSIT 992018', amt: 4200 + ((i * 173) % 2200) });

  // One advance whose payment is re-set on day 45.
  rows5.push({ date: iso(day), desc: 'RAPID FINANCE ACH DEBIT 1900288', amt: i < 45 ? -1285.71 : -950.0 });

  // Two Bitty advances running concurrently the whole time.
  rows5.push({ date: iso(day), desc: 'BITTY ADVANCE ACH DEBIT 55231', amt: -200.0 });
  rows5.push({ date: iso(day), desc: 'BITTY ADVANCE ACH DEBIT 55231', amt: -310.0 });

  // A funding lands mid-period; its weekly debits start right after.
  if (i === 42) rows5.push({ date: iso(day), desc: 'FORA FINANCIAL ACH CREDIT FUNDING', amt: 50_000 });
  if (i > 43 && day.getUTCDay() === 2) rows5.push({ date: iso(day), desc: 'FORA FINANCIAL ACH DEBIT 88120', amt: -1800.0 });
}
const grid5: string[][] = [['Date', 'Description', 'Amount', 'Running Balance']];
for (const r of rows5) { bal5 += r.amt; grid5.push([r.date, r.desc, r.amt.toFixed(2), bal5.toFixed(2)]); }
const rep5 = analyzeStatements(gridToTransactions(grid5, detectColumns(grid5)!, {}).transactions);

console.log('\nswitch/stack scenario → positions:');
for (const p of rep5.positions) {
  console.log(`  ${p.funderName.padEnd(18)} ${String(p.paymentAmount).padStart(8)} ${p.cadence.padEnd(8)} segments=${p.paymentHistory.length} [${p.paymentHistory.map((sg) => sg.amount).join(' -> ')}]`);
}

// The re-set advance must be ONE position with a two-step history.
const rapid5 = rep5.positions.filter((p) => p.funderName === 'Rapid Finance');
if (rapid5.length !== 1) throw new Error(`FAIL(switch): Rapid Finance should be 1 position, got ${rapid5.length}`);
if (!rapid5[0].paymentChanged) throw new Error('FAIL(switch): the payment change was not detected');
if (rapid5[0].paymentHistory.length !== 2) throw new Error(`FAIL(switch): expected 2 payment segments, got ${rapid5[0].paymentHistory.length}`);
if (Math.abs(rapid5[0].paymentAmount - 950) > 0.01) throw new Error(`FAIL(switch): current payment should be the NEW 950, got ${rapid5[0].paymentAmount}`);
if (Math.abs(rapid5[0].originalPayment - 1285.71) > 0.01) throw new Error('FAIL(switch): original payment wrong');

// The two simultaneous Bitty advances must stay separate.
const bitty = rep5.positions.filter((p) => /bitty/i.test(p.funderName));
if (bitty.length !== 2) throw new Error(`FAIL(stack): concurrent advances from one funder should stay separate, got ${bitty.length}`);

// The funding must be recognised as incoming advance money, not revenue.
const funding = rep5.fundingEvents.find((f) => f.funderName === 'Fora Financial');
if (!funding) throw new Error('FAIL(funding): the Fora Financial funding deposit was not detected');
if (funding.confidence !== 'high') throw new Error('FAIL(funding): a named-funder deposit should be high confidence');
if (Math.abs(funding.amount - 50_000) > 0.01) throw new Error('FAIL(funding): wrong funding amount');

const monthWithFunding = rep5.months.find((m) => m.key === funding.date.slice(0, 7))!;
if (monthWithFunding.trueRevenue >= monthWithFunding.deposits) {
  throw new Error('FAIL(funding): advance proceeds were counted as true revenue');
}

// Knowing the start date makes the remaining balance a real number.
const fora = rep5.positions.find((p) => p.funderName === 'Fora Financial');
if (!fora) throw new Error('FAIL(funding): the Fora Financial position was not detected');
if (!fora.startedInPeriod) throw new Error('FAIL(funding): the advance start should be visible in the window');
if (fora.estimatedRemaining === null) throw new Error('FAIL(funding): remaining balance should be determinable');

// Every transaction should be classified, and the funding flagged large.
const cats = new Map<string, number>();
for (const t of rep5.transactions) cats.set(t.category, (cats.get(t.category) ?? 0) + 1);
console.log('categories:', JSON.stringify(Object.fromEntries(cats)));
if (rep5.transactions.length !== rows5.length) throw new Error(`FAIL(annotate): expected ${rows5.length} annotated txns, got ${rep5.transactions.length}`);
if (!cats.get('mca')) throw new Error('FAIL(annotate): no transactions tagged as MCA');
const fundingRow = rep5.transactions.find((t) => t.amount === 50_000)!;
if (fundingRow.category !== 'funding') throw new Error(`FAIL(annotate): the funding row is categorised as ${fundingRow.category}`);
if (!fundingRow.isLarge) throw new Error('FAIL(annotate): a 50k deposit should be flagged large');
console.log('✅ SCENARIO 5 (payment switch, stacking, funding) PASSED');

/* ═══════ Scenario 6: the underwriting workstation ═══════ */

/**
 * Covers the things the workstation adds over raw position detection:
 * gross vs true revenue, cross-account transfer netting, negative days
 * from daily ending balances, NSF vs overdraft separation, withhold %,
 * a position that stops dead, collection activity, and manual overrides
 * re-driving every downstream number.
 */
function mkTxns(rows: { date: string; desc: string; amt: number; bal: number }[]) {
  return rows.map((r) => ({ date: r.date, description: r.desc, amount: r.amt, balance: r.bal }));
}

const opRows: { date: string; desc: string; amt: number; bal: number }[] = [];
let ob = 40_000;
const push = (date: string, desc: string, amt: number) => { ob += amt; opRows.push({ date, desc, amt, bal: ob }); };

for (let i = 0; i < 92; i++) {
  const day = addDays(start, i);
  if (!isWeekday(day)) continue;
  const d = iso(day);
  push(d, 'STRIPE TRANSFER ST-9921', 3400 + ((i * 151) % 1900));
  // Position A runs the whole period.
  push(d, 'RAPID FINANCE ACH DEBIT 1900288', -1285.71);
  // Position B stops dead on day 40, with returns right after → default.
  if (i <= 40) push(d, 'VICTORY FUNDING ACH DEBIT 44219', -600.0);
  // Three returns right after the stop (all weekdays) → default, not payoff.
  if (i === 42 || i === 43 || i === 44) push(d, 'ACH RETURN ITEM UNPAID', -600.0);
  // Same day: the returned item AND its fee. Must count as ONE event.
  if (i === 42) push(d, 'NSF FEE', -35.0);
  if (i === 45) push(d, 'OVERDRAFT FEE', -35.0);
  if (i === 20) push(d, 'ACH DEBIT XYZ SETTLEMENT GROUP', -3500.0);
  if (i === 50) push(d, 'ACH DEBIT XYZ SETTLEMENT GROUP', -3500.0);
  // A transfer OUT to the savings account.
  if (i === 30) push(d, 'ONLINE TRANSFER TO SAVINGS 8891', -25_000);
  // A day in the red.
  if (i === 60) push(d, 'EQUIPMENT PURCHASE VENDOR CO', -(ob + 4200));
}

const savRows: { date: string; desc: string; amt: number; bal: number }[] = [];
let sb = 5_000;
for (let i = 0; i < 92; i++) {
  const day = addDays(start, i);
  if (!isWeekday(day)) continue;
  if (i === 30) { sb += 25_000; savRows.push({ date: iso(day), desc: 'ONLINE TRANSFER FROM CHECKING 1234', amt: 25_000, bal: sb }); }
}

const file = buildUnderwritingFile([
  { id: 'st-op', fileName: 'chase-operating.pdf', transactions: mkTxns(opRows), text: 'CHASE BANK\nACME LOGISTICS LLC\nAccount Number: 000000121234\n', accountId: 'chase-1234', accountLabel: 'Chase ••••1234' },
  { id: 'st-sav', fileName: 'chase-savings.pdf', transactions: mkTxns(savRows), text: 'CHASE BANK\nACME LOGISTICS LLC\nAccount Number: 000000128891\n', accountId: 'chase-8891', accountLabel: 'Chase ••••8891' },
], { generatedAt: '2026-06-02T00:00:00Z' });

console.log('\nworkstation →');
console.log(`  business: ${file.businessName} | accounts ${file.accountCount} | statements ${file.statementCount}`);
console.log(`  gross ${Math.round(file.grossRevenueTotal)} → true ${Math.round(file.trueRevenueTotal)}`);
console.log(`  exclusions: ${JSON.stringify(file.revenueBridge.exclusions.map((e) => [e.label, Math.round(e.amount)]))}`);
console.log(`  negative days ${file.negativeDays.totalNegativeDays} (longest run ${file.negativeDays.longestRun})`);
console.log(`  nsf ${file.nsfCount} | overdraft ${file.overdraftCount} | returned ${file.returnedCount}`);
console.log(`  withhold ${(file.withhold.pct * 100).toFixed(1)}% | current ${file.currentPositions.length} | historical ${file.historicalPositions.length}`);
console.log(`  positions: ${JSON.stringify(file.positions.map((p) => [p.funderName, p.status]))}`);
console.log(`  collections: ${JSON.stringify(file.collections.map((c) => [c.payee, c.count]))}`);
console.log(`  risk: ${JSON.stringify(file.riskFlags.map((f) => f.severity + ':' + f.title).slice(0, 6))}`);

// Cross-account transfer must not inflate revenue.
const transferIn = file.transactions.find((t) => t.amount === 25_000);
if (!transferIn) throw new Error('FAIL(uw): the inbound transfer row is missing');
if (transferIn.isTrueRevenue) throw new Error('FAIL(uw): a transfer between two uploaded accounts counted as revenue');
if (!transferIn.internalTransferPartner) throw new Error('FAIL(uw): the cross-account transfer was not matched to its partner');

// Gross must exceed true by exactly the excluded credits.
const excluded = file.revenueBridge.exclusions.reduce((s, e) => s + e.amount, 0);
if (Math.abs(file.revenueBridge.gross - excluded - file.revenueBridge.trueRevenue) > 0.5) {
  throw new Error('FAIL(uw): the gross → exclusions → true bridge does not reconcile');
}
if (file.trueRevenueTotal >= file.grossRevenueTotal) throw new Error('FAIL(uw): true revenue should be below gross here');

// Negative days come from daily ending balances.
if (file.negativeDays.totalNegativeDays < 1) throw new Error('FAIL(uw): the negative day was not detected');

// NSF and overdraft are tracked separately, not lumped together.
if (file.overdraftCount !== 1) throw new Error(`FAIL(uw): expected 1 overdraft fee, got ${file.overdraftCount}`);
if (file.returnedCount !== 3) throw new Error(`FAIL(uw): expected 3 returned items, got ${file.returnedCount}`);
// The NSF FEE shares a day with a returned item — one bounce, one event.
if (file.nsfCount !== 0) throw new Error(`FAIL(uw): the fee for an already-counted return was double counted (nsf=${file.nsfCount})`);

// Position A active, position B stopped and NOT counted as current.
const rapidP = file.positions.find((p) => p.funderName === 'Rapid Finance');
const victoryP = file.positions.find((p) => /victory/i.test(p.funderName));
if (!rapidP || rapidP.status !== 'active') throw new Error(`FAIL(uw): Rapid should be active, got ${rapidP?.status}`);
if (!victoryP || victoryP.status !== 'possible_default') {
  throw new Error(`FAIL(uw): a position that stopped amid returned ACHs should read as a possible default, got ${victoryP?.status}`);
}
if (file.currentPositions.some((p) => /victory/i.test(p.funderName))) {
  throw new Error('FAIL(uw): a stopped position is being counted in the current MCA burden');
}
if (!rapidP.presentThroughout) throw new Error('FAIL(uw): a position spanning every month is not marked present throughout');

// Withhold reconciles.
const recomputed = file.withhold.totalMonthly / file.withhold.trueRevenueMonthly;
if (Math.abs(recomputed - file.withhold.pct) > 0.0001) throw new Error('FAIL(uw): the withhold audit does not reproduce the percentage');
if (file.withhold.pct <= 0) throw new Error('FAIL(uw): withhold should be above zero');

// Collections detected.
if (!file.collections.length) throw new Error('FAIL(uw): the settlement-group payments were not flagged');

// Risk engine caught the abrupt stop.
if (!file.riskFlags.some((f) => /default|stop payment/i.test(f.title))) {
  throw new Error('FAIL(uw): no risk flag raised for the position that stopped');
}
for (const f of file.riskFlags) {
  if (!f.explanation || f.explanation.length < 20) throw new Error(`FAIL(uw): risk flag "${f.title}" has no explanation`);
}

// Manual override must re-drive true revenue immediately.
const aStripe = file.transactions.find((t) => t.cls === 'revenue' && t.amount > 0)!;
const after = buildUnderwritingFile([
  { id: 'st-op', fileName: 'chase-operating.pdf', transactions: mkTxns(opRows), accountId: 'chase-1234' },
  { id: 'st-sav', fileName: 'chase-savings.pdf', transactions: mkTxns(savRows), accountId: 'chase-8891' },
], { overrides: [{ key: aStripe.key, cls: 'non_revenue' }] });
const delta = file.trueRevenueTotal - after.trueRevenueTotal;
if (Math.abs(delta - aStripe.amount) > 0.5) {
  throw new Error(`FAIL(uw): excluding one ${aStripe.amount} deposit changed true revenue by ${delta}`);
}
const overridden = after.transactions.find((t) => t.key === aStripe.key)!;
if (!overridden.overridden || overridden.isTrueRevenue) throw new Error('FAIL(uw): the override did not take effect');
if (!/Manually set/.test(overridden.reason)) throw new Error('FAIL(uw): an overridden row lost its explanation');

// Every transaction must carry a reason — no black boxes.
for (const t of file.transactions) {
  if (!t.reason || t.reason.length < 8) throw new Error(`FAIL(uw): transaction ${t.key} has no classification reason`);
}

// Account filtering yields account-level underwriting.
const opOnly = buildUnderwritingFile([
  { id: 'st-op', fileName: 'chase-operating.pdf', transactions: mkTxns(opRows), accountId: 'chase-1234' },
  { id: 'st-sav', fileName: 'chase-savings.pdf', transactions: mkTxns(savRows), accountId: 'chase-8891' },
], { accountFilter: 'chase-1234' });
if (opOnly.transactions.some((t) => t.accountId !== 'chase-1234')) throw new Error('FAIL(uw): account filter leaked other accounts');

// Handoff to the existing funder matching keeps its shape.
const criteria = toDealCriteria(file, { industry: 'trucking', state: 'FL' });
if (criteria.positions !== file.currentPositions.length) throw new Error('FAIL(uw): criteria position count mismatch');
if (criteria.monthlyRevenue <= 0) throw new Error('FAIL(uw): criteria revenue missing');
console.log(`  criteria handoff: ${JSON.stringify(criteria)}`);
console.log('✅ SCENARIO 6 (underwriting workstation) PASSED');

runPdfScenarios()
  .then(() => console.log('\n✅ ALL UNDERWRITING TESTS PASSED'))
  .catch((err) => { console.error(String(err && err.message ? err.message : err)); process.exit(1); });
