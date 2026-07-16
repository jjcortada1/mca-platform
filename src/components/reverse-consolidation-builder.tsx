'use client';
/**
 * Reverse Consolidation Sheet — builds a client-facing breakdown for a
 * weekly-disbursement funding consolidation.
 *
 * The document is titled "Reverse Consolidation — {deal/company name}".
 * Economics show the CURRENT payment (red) vs the NEW payment (green) with
 * the savings highlighted in green — % or $, your choice. Term can be
 * entered in days or weeks. The disbursement schedule takes an explicit
 * NUMBER OF DISBURSEMENTS (not assumed from the term), shows ESTIMATED
 * dates, and prints tightly in side-by-side columns so the whole offer
 * fits on one sheet. Every economics line can be shown/hidden; the
 * requirements list auto-suggests contracts from each funder with a
 * balance. Nothing is written to the database — a draft lives in
 * localStorage so refreshing never loses work.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PageHeader, Card, CardContent, Button, Input, Field,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { Plus, Trash2, Eye, EyeOff, Printer, RotateCcw, FileText } from 'lucide-react';

/* ---------- helpers ---------- */

function parseNum(v: string): number | null {
  if (!v || !v.trim()) return null;
  const n = Number(v.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function money(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function chunk<T>(arr: T[], n: number): T[][] {
  const per = Math.ceil(arr.length / n);
  return Array.from({ length: Math.min(n, arr.length) }, (_, i) => arr.slice(i * per, (i + 1) * per))
    .filter((c) => c.length);
}

interface FunderRow { id: string; name: string; balance: string }
interface ScheduleRow { num: number; date: string; amount: string }

type EconKey = 'funding' | 'payback' | 'rate' | 'term' | 'currentPayment' | 'newPayment' | 'savings';

const DEFAULT_REQUIREMENTS = ['Driver’s license', 'Voided check'];
const DRAFT_KEY = 'reverse-consol-sheet:v2';

let rowSeq = 0;
function rid() { return `r${Date.now().toString(36)}_${rowSeq++}`; }

export function ReverseConsolidationBuilder({
  companyName,
  logoUrl,
}: {
  companyName: string;
  logoUrl: string | null;
}) {
  const toast = useToast();

  const [dealName, setDealName] = useState('');
  const [econ, setEcon] = useState<Record<EconKey, string>>({
    funding: '', payback: '', rate: '', term: '', currentPayment: '', newPayment: '', savings: '',
  });
  const [shown, setShown] = useState<Record<EconKey, boolean>>({
    funding: true, payback: true, rate: true, term: true, currentPayment: true, newPayment: true, savings: true,
  });
  // Term unit: daily terms count business days; weekly terms count weeks.
  const [termUnit, setTermUnit] = useState<'daily' | 'weekly'>('weekly');
  // Savings entered as a percent ("40" → 40% savings) or a dollar amount.
  const [savingsMode, setSavingsMode] = useState<'percent' | 'dollar'>('percent');
  const [funders, setFunders] = useState<FunderRow[]>([{ id: rid(), name: '', balance: '' }]);
  const [startDate, setStartDate] = useState('');
  const [numDisbursements, setNumDisbursements] = useState('');
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [requirements, setRequirements] = useState<string[]>(DEFAULT_REQUIREMENTS);
  const [newReq, setNewReq] = useState('');
  const removedAutoReqsRef = useRef<Set<string>>(new Set());
  const restoredRef = useRef(false);

  const payLabel = termUnit === 'daily' ? 'Daily' : 'Weekly';
  const ECON_FIELDS: { key: EconKey; label: string }[] = [
    { key: 'funding', label: 'Total Funding Amount' },
    { key: 'payback', label: 'Total Payback' },
    { key: 'rate', label: 'Rate' },
    { key: 'term', label: 'Term' },
    { key: 'currentPayment', label: `Current ${payLabel} Payment` },
    { key: 'newPayment', label: `New ${payLabel} Payment` },
    { key: 'savings', label: 'Savings' },
  ];

  /* ---------- draft persistence (localStorage, no DB) ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          if (typeof d.dealName === 'string') setDealName(d.dealName);
          if (d.econ) setEcon((cur) => ({ ...cur, ...d.econ }));
          if (d.shown) setShown((cur) => ({ ...cur, ...d.shown }));
          if (d.termUnit === 'daily' || d.termUnit === 'weekly') setTermUnit(d.termUnit);
          if (d.savingsMode === 'percent' || d.savingsMode === 'dollar') setSavingsMode(d.savingsMode);
          if (Array.isArray(d.funders) && d.funders.length) setFunders(d.funders);
          if (typeof d.startDate === 'string') setStartDate(d.startDate);
          if (typeof d.numDisbursements === 'string') setNumDisbursements(d.numDisbursements);
          if (Array.isArray(d.schedule)) setSchedule(d.schedule);
          if (Array.isArray(d.requirements)) setRequirements(d.requirements);
        }
      }
    } catch { /* fresh start */ }
    restoredRef.current = true;
  }, []);
  useEffect(() => {
    if (!restoredRef.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          dealName, econ, shown, termUnit, savingsMode, funders, startDate, numDisbursements, schedule, requirements,
        }));
      } catch { /* storage full/blocked */ }
    }, 400);
    return () => clearTimeout(t);
  }, [dealName, econ, shown, termUnit, savingsMode, funders, startDate, numDisbursements, schedule, requirements]);

  /* ---------- derived economics (suggestions, typed values always win) ---------- */
  const derived = useMemo(() => {
    const funding = parseNum(econ.funding);
    const payback = parseNum(econ.payback);
    const rate = parseNum(econ.rate);
    const term = parseNum(econ.term);
    const effPayback = payback ?? (funding && rate ? Math.round(funding * rate * 100) / 100 : null);
    const nPayments = term && term > 0 ? Math.round(term) : null;
    const newPayment = parseNum(econ.newPayment)
      ?? (effPayback && nPayments ? Math.round((effPayback / nPayments) * 100) / 100 : null);
    const current = parseNum(econ.currentPayment);
    const savingsPct = current && newPayment && current > 0
      ? Math.round((1 - newPayment / current) * 1000) / 10
      : null;
    const savingsDollar = current && newPayment ? Math.round((current - newPayment) * 100) / 100 : null;
    return {
      rate: rate ?? (funding && payback && funding > 0 ? Math.round((payback / funding) * 10000) / 10000 : null),
      payback: effPayback,
      newPayment,
      savingsPct,
      savingsDollar,
    };
  }, [econ]);

  /** Effective display value per econ line — typed value wins, else derived. */
  function econValue(key: EconKey): string {
    const typed = econ[key];
    if (key === 'savings') {
      const n = parseNum(typed);
      if (typed.trim()) {
        if (n === null) return typed; // free text allowed
        return savingsMode === 'percent' ? `${n}% savings` : `${money(n)} per ${payLabel.toLowerCase()} payment`;
      }
      if (savingsMode === 'percent' && derived.savingsPct !== null && derived.savingsPct > 0) return `${derived.savingsPct}% savings`;
      if (savingsMode === 'dollar' && derived.savingsDollar !== null && derived.savingsDollar > 0) return `${money(derived.savingsDollar)} per ${payLabel.toLowerCase()} payment`;
      return '';
    }
    if (typed.trim()) {
      const n = parseNum(typed);
      if (key === 'rate') return n !== null ? n.toFixed(n < 10 ? 2 : 0) : typed;
      if (key === 'term') return n !== null ? `${n} ${termUnit === 'daily' ? 'days' : 'weeks'}` : typed;
      return n !== null ? money(n) : typed;
    }
    if (key === 'rate' && derived.rate !== null) return derived.rate.toFixed(2);
    if (key === 'payback' && derived.payback !== null) return money(derived.payback);
    if (key === 'newPayment' && derived.newPayment !== null) return money(derived.newPayment);
    return '';
  }

  /** Tone per econ line for the colored presentation. */
  function econTone(key: EconKey): 'red' | 'green' | undefined {
    if (key === 'currentPayment') return 'red';
    if (key === 'newPayment' || key === 'savings') return 'green';
    return undefined;
  }

  /* ---------- funders + auto requirements ---------- */
  const funderTotal = useMemo(
    () => funders.reduce((acc, f) => acc + (parseNum(f.balance) ?? 0), 0),
    [funders]
  );

  useEffect(() => {
    if (!restoredRef.current) return;
    const wanted = funders
      .filter((f) => f.name.trim() && parseNum(f.balance) !== null)
      .map((f) => `Contracts from ${f.name.trim()}`);
    setRequirements((cur) => {
      const missing = wanted.filter((w) =>
        !cur.some((r) => r.toLowerCase() === w.toLowerCase()) &&
        !removedAutoReqsRef.current.has(w.toLowerCase()));
      return missing.length ? [...cur, ...missing] : cur;
    });
  }, [funders]);

  function removeRequirement(idx: number) {
    setRequirements((cur) => {
      const r = cur[idx];
      if (r?.toLowerCase().startsWith('contracts from ')) {
        removedAutoReqsRef.current.add(r.toLowerCase());
      }
      return cur.filter((_, i) => i !== idx);
    });
  }

  /* ---------- disbursement schedule ---------- */
  function generateSchedule() {
    const funding = parseNum(econ.funding);
    const count = parseNum(numDisbursements);
    if (!count || count < 1 || count > 260) {
      toast.error('Enter how many disbursements there are (the term doesn’t decide this — you do).');
      return;
    }
    const n = Math.round(count);
    const per = funding ? Math.floor((funding / n) * 100) / 100 : null;
    const start = startDate ? new Date(`${startDate}T00:00:00`) : new Date();
    const rows: ScheduleRow[] = [];
    let allocated = 0;
    for (let i = 0; i < n; i++) {
      // Equal split as a starting point (last row absorbs rounding) — every
      // amount is editable, since real disbursements rarely stay uniform.
      let amount = '';
      if (per !== null && funding) {
        const a = i === n - 1 ? Math.round((funding - allocated) * 100) / 100 : per;
        allocated += a;
        amount = String(a);
      }
      rows.push({ num: i + 1, date: fmtDate(addDays(start, i * 7)), amount });
    }
    setSchedule(rows);
  }

  const scheduleTotal = useMemo(
    () => schedule.reduce((acc, r) => acc + (parseNum(r.amount) ?? 0), 0),
    [schedule]
  );

  /* ---------- print / PDF ---------- */
  function generatePdf() {
    if (!dealName.trim()) { toast.error('Enter the deal / company name first — it headlines the sheet.'); return; }
    const econRows = ECON_FIELDS
      .filter((f) => shown[f.key] && econValue(f.key))
      .map((f) => {
        const tone = econTone(f.key);
        const cls = tone === 'red' ? ' style="color:#dc2626"' : tone === 'green' ? ' style="color:#16a34a"' : '';
        return `<tr><td class="k">${esc(f.label)}</td><td class="v"${cls}>${esc(econValue(f.key))}</td></tr>`;
      })
      .join('');
    const funderRows = funders
      .filter((f) => f.name.trim() || parseNum(f.balance) !== null)
      .map((f) => `<tr><td>${esc(f.name.trim() || '—')}</td><td class="v">${esc(money(parseNum(f.balance)))}</td></tr>`)
      .join('');
    // Schedule prints in side-by-side columns (up to 4) so the whole sheet
    // ALWAYS consolidates onto one page, even with 28+ disbursements.
    const schedColCount = schedule.length > 36 ? 4 : schedule.length > 18 ? 3 : schedule.length > 8 ? 2 : 1;
    const schedCols = chunk(schedule, schedColCount)
      .map((col) => `<table class="sched"><tr><th>#</th><th>Est. date</th><th style="text-align:right">Amount</th></tr>${
        col.map((r) => `<tr><td>${r.num}</td><td>${esc(r.date)}</td><td class="v">${esc(money(parseNum(r.amount)))}</td></tr>`).join('')
      }</table>`)
      .join('');
    // Dense mode shrinks type + padding when there's a lot of content, and
    // a print zoom factor scales the WHOLE document down as load grows —
    // the sheet never spills onto a second page, period.
    const contentLoad = schedule.length + funders.length * 2 + requirements.length * 1.5;
    const dense = contentLoad > 26;
    const zoom = contentLoad > 60 ? 0.75 : contentLoad > 45 ? 0.85 : contentLoad > 32 ? 0.92 : 1;
    const reqCols = requirements.filter((r) => r.trim()).length > 5 ? 2 : 1;
    const reqRows = requirements.filter((r) => r.trim()).map((r) => `<li>${esc(r)}</li>`).join('');
    const today = fmtDate(new Date());

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Reverse Consolidation — ${esc(dealName)}</title>
<style>
  @page { size: letter; margin: 0.3in; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; padding: 40px 48px; font-size: ${dense ? '11.5px' : '13px'}; line-height: ${dense ? '1.28' : '1.45'}; zoom: ${zoom}; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 20px; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand img { height: 46px; width: auto; max-width: 180px; object-fit: contain; }
  .brand .name { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
  .date { color: #6b7280; font-size: 12px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .sub { color: #6b7280; margin-bottom: 16px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: ${dense ? '2.5px 7px' : '5px 9px'}; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; font-size: ${dense ? '11px' : '12.5px'}; }
  td.k { color: #374151; width: 55%; }
  td.v { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  tr.total td { border-top: 2px solid #111827; border-bottom: none; font-weight: 700; }
  .schedwrap { display: flex; gap: 18px; align-items: flex-start; }
  table.sched { flex: 1; }
  table.sched td, table.sched th { padding: ${dense ? '1.5px 6px' : '3.5px 8px'}; font-size: ${dense ? '10.5px' : '12px'}; }
  .schedtotal { margin-top: 6px; text-align: right; font-weight: 700; font-size: 12.5px; }
  ul { padding-left: 18px; columns: ${reqCols}; column-gap: 28px; }
  li { margin: 2.5px 0; break-inside: avoid; }
  .brand img { height: ${dense ? '36px' : '46px'}; }
  @media print { body { padding: ${dense ? '6px 12px' : '20px 26px'}; } h2 { margin: ${dense ? '8px 0 3px' : '18px 0 6px'}; } .head { padding-bottom: ${dense ? '8px' : '14px'}; margin-bottom: ${dense ? '10px' : '20px'}; } }
</style></head><body>
  <div class="head">
    <div class="brand">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}
      <div class="name">${esc(companyName)}</div>
    </div>
    <div class="date">${esc(today)}</div>
  </div>
  <h1>Reverse Consolidation — ${esc(dealName)}</h1>
  <div class="sub">Funding consolidation structured on weekly disbursements.</div>

  ${econRows ? `<h2>Breakdown</h2><table>${econRows}</table>` : ''}

  ${funderRows ? `<h2>Positions Being Consolidated</h2><table>
    <tr><th>Funder</th><th style="text-align:right">Balance</th></tr>${funderRows}
    <tr class="total"><td>Total balances</td><td class="v">${esc(money(funderTotal))}</td></tr>
  </table>` : ''}

  ${schedule.length ? `<h2>Disbursement Schedule (${schedule.length} weekly disbursements)</h2>
    <div class="schedwrap">${schedCols}</div>
    <div class="schedtotal">Total disbursed: ${esc(money(scheduleTotal))}</div>` : ''}

  ${reqRows ? `<h2>Requirements to Fund</h2><ul>${reqRows}</ul>` : ''}
<script>window.onload = function(){ window.print(); };</script>
</body></html>`;

    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) { toast.error('Your browser blocked the print window — allow pop-ups for this site.'); return; }
    w.document.write(html);
    w.document.close();
  }

  function clearAll() {
    setDealName('');
    setEcon({ funding: '', payback: '', rate: '', term: '', currentPayment: '', newPayment: '', savings: '' });
    setShown({ funding: true, payback: true, rate: true, term: true, currentPayment: true, newPayment: true, savings: true });
    setTermUnit('weekly');
    setSavingsMode('percent');
    setFunders([{ id: rid(), name: '', balance: '' }]);
    setStartDate('');
    setNumDisbursements('');
    setSchedule([]);
    setRequirements(DEFAULT_REQUIREMENTS);
    removedAutoReqsRef.current.clear();
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }

  function econPlaceholder(key: EconKey): string {
    switch (key) {
      case 'funding': return '150,000';
      case 'payback': return `auto: ${derived.payback !== null ? money(derived.payback) : 'funding × rate'}`;
      case 'rate': return `auto: ${derived.rate !== null ? derived.rate.toFixed(2) : 'payback ÷ funding'}`;
      case 'term': return termUnit === 'daily' ? 'e.g. 120 (days)' : 'e.g. 26 (weeks)';
      case 'currentPayment': return `what they pay per ${payLabel.toLowerCase() === 'daily' ? 'day' : 'week'} now`;
      case 'newPayment': return `auto: ${derived.newPayment !== null ? money(derived.newPayment) : 'payback ÷ term'}`;
      case 'savings': return savingsMode === 'percent'
        ? `auto: ${derived.savingsPct !== null && derived.savingsPct > 0 ? `${derived.savingsPct}%` : 'from current vs new'}`
        : `auto: ${derived.savingsDollar !== null && derived.savingsDollar > 0 ? money(derived.savingsDollar) : 'from current vs new'}`;
      default: return '';
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        title="Reverse Consolidation Sheet"
        description="Build a clean, branded sheet for a weekly-disbursement consolidation: breakdown, positions, disbursement schedule, and requirements to fund — then generate a PDF."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={clearAll}><RotateCcw className="h-4 w-4" /> Clear</Button>
            <Button onClick={generatePdf}><Printer className="h-4 w-4" /> Generate PDF</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* ---- LEFT: inputs ---- */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Deal
              </div>
              <Field label="Deal / company name" required>
                <Input value={dealName} onChange={(e) => setDealName(e.target.value)} placeholder="e.g. ABC Logistics LLC" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Breakdown</div>
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-muted-foreground mr-1">Payments:</span>
                  {(['weekly', 'daily'] as const).map((u) => (
                    <button
                      key={u}
                      onClick={() => setTermUnit(u)}
                      className={cn('px-2 py-1 rounded border text-xs font-medium transition',
                        termUnit === u ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground')}
                    >
                      {u === 'weekly' ? 'Weekly' : 'Daily'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter what you have — rate, payback, the new payment, and savings auto-derive. The eye toggles what shows on the sheet.
              </p>
              <div className="space-y-2">
                {ECON_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <button
                      onClick={() => setShown((s) => ({ ...s, [f.key]: !s[f.key] }))}
                      title={shown[f.key] ? 'Shown on the sheet — click to hide' : 'Hidden from the sheet — click to show'}
                      className={cn('p-1.5 rounded-md transition-colors shrink-0',
                        shown[f.key] ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground/40 hover:bg-muted')}
                    >
                      {shown[f.key] ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <div className={cn(
                      'w-44 text-xs font-medium shrink-0',
                      econTone(f.key) === 'red' && 'text-red-600 dark:text-red-400',
                      econTone(f.key) === 'green' && 'text-emerald-600 dark:text-emerald-400',
                    )}>
                      {f.label}
                    </div>
                    <Input
                      className={cn('h-8 flex-1', !shown[f.key] && 'opacity-50')}
                      value={econ[f.key]}
                      onChange={(e) => setEcon((cur) => ({ ...cur, [f.key]: e.target.value }))}
                      placeholder={econPlaceholder(f.key)}
                    />
                    {f.key === 'savings' && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        {(['percent', 'dollar'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setSavingsMode(m)}
                            title={m === 'percent' ? 'Savings as a percentage' : 'Savings as a dollar amount'}
                            className={cn('px-1.5 py-1 rounded border text-xs font-semibold transition',
                              savingsMode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground')}
                          >
                            {m === 'percent' ? '%' : '$'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold">Positions being consolidated</div>
              <p className="text-xs text-muted-foreground">
                Each funder with a balance is auto-added to Requirements to Fund as &ldquo;Contracts from …&rdquo;.
              </p>
              <div className="space-y-2">
                {funders.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <Input
                      className="h-8 flex-1"
                      value={f.name}
                      onChange={(e) => setFunders((arr) => arr.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))}
                      placeholder="Funder name"
                    />
                    <Input
                      className="h-8 w-36"
                      inputMode="decimal"
                      value={f.balance}
                      onChange={(e) => setFunders((arr) => arr.map((x, xi) => xi === i ? { ...x, balance: e.target.value } : x))}
                      placeholder="Balance"
                    />
                    <button
                      onClick={() => setFunders((arr) => arr.filter((_, xi) => xi !== i))}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-muted"
                      title="Remove funder"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <Button size="sm" variant="outline" onClick={() => setFunders((arr) => [...arr, { id: rid(), name: '', balance: '' }])}>
                  <Plus className="h-3.5 w-3.5" /> Add funder
                </Button>
                <div className="text-xs text-muted-foreground">
                  Total balances: <span className="font-semibold text-foreground tabular-nums">{money(funderTotal)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold">Weekly disbursement schedule</div>
              <p className="text-xs text-muted-foreground">
                You choose how many disbursements — the term doesn&apos;t decide it. Amounts start as an even split of the funding and every one is editable. Dates are estimates.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="# of disbursements" className="w-[150px]">
                  <Input
                    className="h-8"
                    inputMode="numeric"
                    value={numDisbursements}
                    onChange={(e) => setNumDisbursements(e.target.value)}
                    placeholder="e.g. 28"
                  />
                </Field>
                <Field label="First disbursement" className="w-[170px]">
                  <Input type="date" className="h-8" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Button size="sm" variant="outline" onClick={generateSchedule}>
                  Generate {numDisbursements ? `${numDisbursements} rows` : 'schedule'}
                </Button>
              </div>
              {schedule.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr className="text-left">
                          <th className="px-3 py-1.5 font-semibold">#</th>
                          <th className="px-3 py-1.5 font-semibold">Estimated date</th>
                          <th className="px-3 py-1.5 font-semibold text-right">Amount</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {schedule.map((r, i) => (
                          <tr key={r.num}>
                            <td className="px-3 py-1">{r.num}</td>
                            <td className="px-3 py-1 text-muted-foreground">{r.date}</td>
                            <td className="px-1 py-0.5 text-right">
                              <input
                                value={r.amount}
                                onChange={(e) => setSchedule((arr) => arr.map((x, xi) => xi === i ? { ...x, amount: e.target.value } : x))}
                                placeholder="amount"
                                className="w-24 text-right bg-transparent px-2 py-0.5 rounded outline-none focus:ring-1 focus:ring-ring/40 tabular-nums"
                              />
                            </td>
                            <td className="pr-2">
                              <button
                                onClick={() => setSchedule((arr) => arr.filter((_, xi) => xi !== i))}
                                className="p-0.5 rounded text-muted-foreground/40 hover:text-rose-500"
                                title="Remove disbursement"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-3 py-1.5 border-t border-border bg-muted/20 text-xs flex justify-between">
                    <span className="text-muted-foreground">Total disbursed ({schedule.length})</span>
                    <span className="font-semibold tabular-nums">{money(scheduleTotal)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold">Requirements to fund</div>
              <div className="space-y-1.5">
                {requirements.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="h-8 flex-1"
                      value={r}
                      onChange={(e) => setRequirements((arr) => arr.map((x, xi) => xi === i ? e.target.value : x))}
                    />
                    <button
                      onClick={() => removeRequirement(i)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-muted"
                      title="Remove requirement"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 flex-1"
                    value={newReq}
                    onChange={(e) => setNewReq(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newReq.trim()) {
                        setRequirements((arr) => [...arr, newReq.trim()]);
                        setNewReq('');
                      }
                    }}
                    placeholder="Add a requirement…"
                  />
                  <Button size="sm" variant="outline" onClick={() => {
                    if (!newReq.trim()) return;
                    setRequirements((arr) => [...arr, newReq.trim()]);
                    setNewReq('');
                  }}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ---- RIGHT: live preview ---- */}
        <Card className="lg:sticky lg:top-4">
          <CardContent className="p-5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-3">Sheet preview</div>
            <div className="rounded-lg border border-border bg-card p-5 space-y-4 text-sm">
              <div className="flex items-center justify-between gap-3 border-b-2 border-foreground pb-3">
                <div className="flex items-center gap-3 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {logoUrl && <img src={logoUrl} alt="" className="h-9 w-auto max-w-[120px] object-contain" />}
                  <div className="font-bold truncate">{companyName}</div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">{fmtDate(new Date())}</div>
              </div>
              <div>
                <div className="font-semibold">Reverse Consolidation{dealName ? ` — ${dealName}` : ''}</div>
                <div className="text-xs text-muted-foreground">Funding consolidation structured on weekly disbursements.</div>
              </div>

              {ECON_FIELDS.some((f) => shown[f.key] && econValue(f.key)) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Breakdown</div>
                  <div className="divide-y divide-border/60">
                    {ECON_FIELDS.filter((f) => shown[f.key] && econValue(f.key)).map((f) => (
                      <div key={f.key} className="flex justify-between py-1">
                        <span className="text-muted-foreground">{f.label}</span>
                        <span className={cn(
                          'font-semibold tabular-nums',
                          econTone(f.key) === 'red' && 'text-red-600 dark:text-red-400',
                          econTone(f.key) === 'green' && 'text-emerald-600 dark:text-emerald-400',
                        )}>
                          {econValue(f.key)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {funders.some((f) => f.name.trim() || parseNum(f.balance) !== null) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Positions being consolidated</div>
                  <div className="divide-y divide-border/60">
                    {funders.filter((f) => f.name.trim() || parseNum(f.balance) !== null).map((f) => (
                      <div key={f.id} className="flex justify-between py-1">
                        <span>{f.name.trim() || '—'}</span>
                        <span className="font-semibold tabular-nums">{money(parseNum(f.balance))}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 border-t-2 !border-foreground">
                      <span className="font-semibold">Total balances</span>
                      <span className="font-bold tabular-nums">{money(funderTotal)}</span>
                    </div>
                  </div>
                </div>
              )}

              {schedule.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                    Disbursement schedule — {schedule.length} weekly disbursements, {money(scheduleTotal)} total
                  </div>
                  {/* Tight side-by-side columns, mirroring the printed sheet. */}
                  <div className="grid grid-cols-2 gap-x-4 text-xs">
                    {chunk(schedule, 2).map((col, ci) => (
                      <div key={ci} className="divide-y divide-border/40">
                        {col.map((r) => (
                          <div key={r.num} className="flex justify-between gap-2 py-0.5">
                            <span className="text-muted-foreground shrink-0">#{r.num} · {r.date}</span>
                            <span className="font-medium tabular-nums">{money(parseNum(r.amount))}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {requirements.some((r) => r.trim()) && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Requirements to fund</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-xs">
                    {requirements.filter((r) => r.trim()).map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <Button onClick={generatePdf}><Printer className="h-4 w-4" /> Generate PDF</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
