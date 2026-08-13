'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Input, Select, Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import {
  Upload, Loader2, X, AlertTriangle, CheckCircle2, Trash2, Download, Copy,
  ClipboardPaste, ShieldCheck, Pencil,
} from 'lucide-react';
import {
  detectColumns, detectColumnsHeaderless, gridToTransactions, parseStatementText,
} from '@/lib/underwriting/parse';
import type { Transaction, DetectResult, ColumnMap } from '@/lib/underwriting/parse';
import { extractPdfText } from '@/lib/underwriting/pdf';
import { buildUnderwritingFile } from '@/lib/underwriting/workstation';
import type {
  StatementInput, TxnOverride, TxnClass, UnderwritingFile, ReviewStatus, ManualMca,
} from '@/lib/underwriting/workstation';
import { reportToText } from '@/lib/underwriting/engine';
import { analyzeStatements } from '@/lib/underwriting/engine';
import {
  OverviewPanel, CashFlowPanel, RevenueReviewPanel, PositionsPanel, RiskPanel,
  TransactionsPanel, StatementsPanel, TransfersPanel,
} from './panels';
import { DrillDownPanel, money, longDate } from './shared';
import type { DrillDown } from './shared';

/**
 * The MCA underwriting workstation.
 *
 * ────────────────────────────────────────────────────────────────────
 * Deterministic and local. Statements are parsed in the browser, scored
 * by the rule engine in src/lib/underwriting/, and never uploaded. No AI
 * model or external API is involved at any point.
 * ────────────────────────────────────────────────────────────────────
 *
 * Structure: an intake bar, a file header, and seven tabs. The Overview
 * is the dashboard; everything else has its own tab rather than being
 * piled onto one page.
 *
 * All manual classification lives in `overrides` here. Changing one
 * re-runs buildUnderwritingFile, so every downstream number — true
 * revenue, withhold %, monthly table, risk flags — updates in the same
 * render. There is no partial-recalculation path to get out of sync.
 */

type Tab = 'overview' | 'positions' | 'transfers' | 'cashflow' | 'revenue' | 'risk' | 'transactions' | 'statements';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'positions', label: 'MCA Positions' },
  { key: 'transfers', label: 'Transfer Accounts' },
  { key: 'cashflow', label: 'Cash Flow' },
  { key: 'revenue', label: 'Revenue Review' },
  { key: 'risk', label: 'Risk Flags' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'statements', label: 'Statements' },
];

/** Stages shown while parsing, so a slow file never looks frozen. */
type Stage = null | 'reading' | 'parsing' | 'identifying' | 'calculating' | 'done';
const STAGE_LABEL: Record<Exclude<Stage, null>, string> = {
  reading: 'Reading statements',
  parsing: 'Parsing transactions',
  identifying: 'Identifying MCA activity',
  calculating: 'Calculating cash flow',
  done: 'Complete',
};

interface LoadedStatement {
  id: string;
  fileName: string;
  transactions: Transaction[];
  text?: string;
  pageCount: number | null;
  grid: string[][] | null;
  detected: DetectResult | null;
  error: string | null;
  needsMapping: boolean;
  warnings: string[];
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const COLUMN_FIELDS: { key: keyof ColumnMap; label: string; required: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount (signed)', required: false },
  { key: 'debit', label: 'Withdrawal / debit', required: false },
  { key: 'credit', label: 'Deposit / credit', required: false },
  { key: 'balance', label: 'Running balance', required: false },
];

export function UnderwritingWorkstation() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<any>(null);

  const [statements, setStatements] = useState<LoadedStatement[]>([]);
  const [overrides, setOverrides] = useState<TxnOverride[]>([]);
  const [positionDecisions, setPositionDecisions] = useState<Record<string, ReviewStatus>>({});
  const [transferDecisions, setTransferDecisions] = useState<Record<string, ReviewStatus>>({});
  const [manualMcas, setManualMcas] = useState<ManualMca[]>([]);
  const [mcaDraft, setMcaDraft] = useState<null | {
    txnKeys: string[]; merchantKey: string | null; funderName: string;
    fundingAmount: string; fundingDate: string; paymentAmount: string;
    cadence: 'daily' | 'weekly' | 'bi-weekly' | 'monthly'; applyToAll: boolean;
  }>(null);
  const [businessName, setBusinessName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [tab, setTab] = useState<Tab>('overview');
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const [stage, setStage] = useState<Stage>(null);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string>('');

  /* ───────────────────────── intake ───────────────────────── */

  const parsePdf = useCallback(async (file: File): Promise<LoadedStatement> => {
    const base: LoadedStatement = {
      id: newId(), fileName: file.name, transactions: [], pageCount: null,
      grid: null, detected: null, error: null, needsMapping: false, warnings: [],
    };
    try {
      const extracted = await extractPdfText(await file.arrayBuffer());
      if (!extracted.hasTextLayer) {
        return { ...base, error: 'This PDF is a scan — it holds page images, not text. Ask for the statement downloaded from online banking, or use the CSV export.' };
      }
      const parsed = parseStatementText(extracted.text, { source: file.name });
      if (!parsed.transactions.length) {
        return { ...base, error: `Read ${extracted.pageCount} page(s) of text but found no transaction rows. Try the CSV export or paste the lines.` };
      }
      return { ...base, transactions: parsed.transactions, text: extracted.text, pageCount: extracted.pageCount, warnings: parsed.warnings };
    } catch {
      return { ...base, error: 'Could not open that PDF. If it is password-protected, remove the password first.' };
    }
  }, []);

  const parseGrid = useCallback(async (file: File): Promise<LoadedStatement> => {
    const base: LoadedStatement = {
      id: newId(), fileName: file.name, transactions: [], pageCount: null,
      grid: null, detected: null, error: null, needsMapping: false, warnings: [],
    };
    try {
      if (!xlsxRef.current) xlsxRef.current = await import('xlsx');
      const XLSX = xlsxRef.current;
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.SheetNames[0];
      if (!sheet) return { ...base, error: 'That file has no sheets in it.' };
      const grid: string[][] = XLSX.utils
        .sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' })
        .map((r: any[]) => (Array.isArray(r) ? r.map((v) => (v == null ? '' : String(v))) : []));

      const detected = detectColumns(grid) ?? detectColumnsHeaderless(grid);
      if (!detected) return { ...base, grid, needsMapping: true };
      const parsed = gridToTransactions(grid, detected, { source: file.name });
      if (!parsed.transactions.length) {
        return { ...base, grid, detected, needsMapping: true, error: 'No transactions could be read with the detected columns.' };
      }
      return {
        ...base, grid, detected, transactions: parsed.transactions, warnings: parsed.warnings,
        text: grid.slice(0, 12).map((r) => r.join(' ')).join('\n'),
      };
    } catch {
      return { ...base, error: 'Could not read that file. Export it as .csv or .xlsx and try again.' };
    }
  }, []);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setStage('reading');
    try {
      const results: LoadedStatement[] = [];
      for (const f of incoming) {
        setStage('parsing');
        if (/\.pdf$/i.test(f.name)) results.push(await parsePdf(f));
        else if (/\.(txt|text)$/i.test(f.name)) {
          const parsed = parseStatementText(await f.text(), { source: f.name });
          results.push({
            id: newId(), fileName: f.name, transactions: parsed.transactions, pageCount: null,
            grid: null, detected: null, warnings: parsed.warnings, needsMapping: false,
            error: parsed.transactions.length ? null : 'No transaction lines were recognized.',
          });
        } else results.push(await parseGrid(f));
      }
      setStage('identifying');
      setStatements((prev) => [...prev, ...results]);
      setStage('calculating');
      const ok = results.filter((r) => r.transactions.length);
      const total = ok.reduce((s, r) => s + r.transactions.length, 0);
      if (ok.length) toast.success(`Read ${total.toLocaleString()} transactions from ${ok.length} statement${ok.length === 1 ? '' : 's'}.`);
      const bad = results.filter((r) => r.error || r.needsMapping);
      if (bad.length) toast.error(`${bad.length} file${bad.length === 1 ? ' needs' : 's need'} attention below.`);
      setLastUpdated(new Date().toLocaleString());
      setStage('done');
      window.setTimeout(() => setStage(null), 1200);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [parsePdf, parseGrid, toast]);

  function applyMapping(id: string, map: ColumnMap, headerRow: number) {
    setStatements((prev) => prev.map((s) => {
      if (s.id !== id || !s.grid) return s;
      const detected: DetectResult = { headerRow, headers: s.grid[headerRow] ?? [], map };
      const parsed = gridToTransactions(s.grid, detected, { source: s.fileName });
      if (!parsed.transactions.length) {
        toast.error('Still no transactions with those columns.');
        return { ...s, detected, error: 'No transactions could be read with those columns.' };
      }
      toast.success(`Read ${parsed.transactions.length.toLocaleString()} transactions.`);
      return { ...s, detected, transactions: parsed.transactions, warnings: parsed.warnings, error: null, needsMapping: false };
    }));
    setLastUpdated(new Date().toLocaleString());
  }

  function analyzePaste() {
    const text = pasteText.trim();
    if (!text) { toast.error('Paste the transaction lines first.'); return; }
    const parsed = parseStatementText(text, { source: 'Pasted text' });
    if (!parsed.transactions.length) { toast.error('No transaction lines were recognized.'); return; }
    setStatements((prev) => [...prev, {
      id: newId(), fileName: `Pasted text (${parsed.transactions.length} rows)`,
      transactions: parsed.transactions, text, pageCount: null, grid: null, detected: null,
      error: null, needsMapping: false, warnings: parsed.warnings,
    }]);
    setPasteText('');
    setPasteOpen(false);
    setLastUpdated(new Date().toLocaleString());
    toast.success(`Read ${parsed.transactions.length.toLocaleString()} transactions.`);
  }

  /* ───────────────────────── analysis ───────────────────────── */

  const inputs: StatementInput[] = useMemo(
    () => statements.filter((s) => s.transactions.length).map((s) => ({
      id: s.id,
      fileName: s.fileName,
      transactions: s.transactions,
      text: s.text,
      pageCount: s.pageCount,
    })),
    [statements],
  );

  const file: UnderwritingFile = useMemo(() => buildUnderwritingFile(inputs, {
    overrides,
    businessName: businessName || undefined,
    accountFilter: accountFilter === 'all' ? null : accountFilter,
    positionDecisions,
    transferDecisions,
    manualMcas,
    warnings: Array.from(new Set(statements.flatMap((s) => s.warnings))),
    generatedAt: lastUpdated,
  }), [inputs, overrides, businessName, accountFilter, positionDecisions, transferDecisions, manualMcas, statements, lastUpdated]);

  /* Classification changes flow through one setter, so the whole file is
     rebuilt from scratch every time — nothing can drift out of sync. */
  const onOverride = useCallback((keys: string[], cls: TxnClass) => {
    setOverrides((prev) => {
      const next = prev.filter((o) => !keys.includes(o.key));
      return [...next, ...keys.map((key) => ({ key, cls }))];
    });
    setLastUpdated(new Date().toLocaleString());
  }, []);

  const onResetOverride = useCallback((keys: string[]) => {
    setOverrides((prev) => prev.filter((o) => !keys.includes(o.key)));
    setLastUpdated(new Date().toLocaleString());
  }, []);

  const onPositionDecision = useCallback((id: string, status: ReviewStatus | null) => {
    setPositionDecisions((prev) => {
      const next = { ...prev };
      if (status === null) delete next[id]; else next[id] = status;
      return next;
    });
    setLastUpdated(new Date().toLocaleString());
  }, []);

  const onTransferDecision = useCallback((id: string, status: ReviewStatus | null) => {
    setTransferDecisions((prev) => {
      const next = { ...prev };
      if (status === null) delete next[id]; else next[id] = status;
      return next;
    });
    setLastUpdated(new Date().toLocaleString());
  }, []);

  /** Open the dialog pre-filled from the selected transactions. */
  const onMarkMca = useCallback((txnKeys: string[], merchantKey: string | null, suggestedName: string) => {
    if (!txnKeys.length) { toast.error('Select the transactions first.'); return; }
    setMcaDraft({
      txnKeys, merchantKey, funderName: suggestedName,
      fundingAmount: '', fundingDate: '', paymentAmount: '',
      cadence: 'weekly', applyToAll: Boolean(merchantKey),
    });
  }, [toast]);

  function saveManualMca() {
    if (!mcaDraft) return;
    const name = mcaDraft.funderName.trim();
    if (!name) { toast.error('Give the MCA company a name.'); return; }
    const num = (v: string) => {
      const n = Number(String(v).replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    setManualMcas((prev) => [...prev, {
      id: `manual-${newId()}`,
      funderName: name,
      fundingAmount: num(mcaDraft.fundingAmount),
      fundingDate: mcaDraft.fundingDate || null,
      paymentAmount: num(mcaDraft.paymentAmount),
      cadence: mcaDraft.cadence,
      txnKeys: mcaDraft.txnKeys,
      merchantKey: mcaDraft.applyToAll ? mcaDraft.merchantKey : null,
    }]);
    setMcaDraft(null);
    setLastUpdated(new Date().toLocaleString());
    toast.success(`${name} added to current MCAs.`);
  }

  function clearAll() {
    setStatements([]);
    setOverrides([]);
    setPositionDecisions({});
    setTransferDecisions({});
    setManualMcas([]);
    setBusinessName('');
    setAccountFilter('all');
    setTab('overview');
  }

  const summaryText = useMemo(() => {
    if (!file.hasData) return '';
    const legacy = analyzeStatements(inputs.flatMap((i) => i.transactions), file.warnings);
    return reportToText(legacy, file.businessName);
  }, [file, inputs]);

  async function copySummary() {
    try { await navigator.clipboard.writeText(summaryText); toast.success('Summary copied.'); }
    catch { toast.error('Copy failed — the browser blocked clipboard access.'); }
  }

  function downloadSummary() {
    const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(file.businessName || 'underwriting').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const panelProps = {
    file, onDrill: setDrill, onOverride, onResetOverride,
    onPositionDecision, onTransferDecision, onMarkMca,
  };
  const hasFiles = statements.length > 0;

  return (
    <div className="space-y-4">
      {/* ── File header ── */}
      <header className="border border-border bg-card rounded-md">
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setEditingName(false); }}
                  placeholder="Business name"
                  className="h-8 w-72 text-[18px] font-semibold"
                />
                <Button variant="outline" className="h-8" onClick={() => setEditingName(false)}>Done</Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="group flex items-center gap-2 text-left"
                title="Rename"
              >
                <h1 className="text-[22px] font-semibold tracking-tight leading-none truncate max-w-[540px]">
                  {file.hasData || businessName ? file.businessName : 'New underwriting file'}
                </h1>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
            {file.hasData ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                <span>Underwriting period: <span className="text-foreground font-medium">{longDate(file.periodStart)} – {longDate(file.periodEnd)}</span></span>
                <span>Statements analyzed: <span className="text-foreground font-medium">{file.statementCount}</span></span>
                <span>Accounts analyzed: <span className="text-foreground font-medium">{file.accountCount}</span></span>
                {lastUpdated && <span>Last updated: <span className="text-foreground font-medium">{lastUpdated}</span></span>}
                {file.businessNameSource === 'detected' && <Badge variant="outline">Name read from statement</Badge>}
              </div>
            ) : (
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                Load bank statements to build the file. Runs on local code in your browser — no AI credits, nothing uploaded.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {file.accounts.length > 1 && (
              <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="h-8 w-auto text-[12.5px]">
                <option value="all">All accounts</option>
                {file.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
            )}
            {file.hasData && (
              <>
                <Button variant="outline" className="h-8" onClick={copySummary}><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy</Button>
                <Button className="h-8" onClick={downloadSummary}><Download className="h-3.5 w-3.5 mr-1.5" /> Report</Button>
              </>
            )}
          </div>
        </div>

        {/* ── Tabs ── */}
        {file.hasData && (
          <nav className="flex items-center gap-0 px-2 border-t border-border overflow-x-auto scrollbar-none">
            {TABS.map((t) => {
              const active = tab === t.key;
              const count =
                t.key === 'risk' ? file.riskFlags.length
                  : t.key === 'positions' ? file.currentPositions.length
                    : t.key === 'transfers' ? file.transferAccounts.length
                      : t.key === 'transactions' ? file.transactions.length
                        : null;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`relative px-3 py-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors ${
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                  {count !== null && count > 0 && (
                    <span className="ml-1.5 text-[10.5px] text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
                  )}
                  {active && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-foreground rounded-full" />}
                </button>
              );
            })}
          </nav>
        )}
      </header>

      {/* ── Intake ── */}
      <div className="border border-border bg-card rounded-md p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex-1 min-w-[280px] flex items-center gap-3 rounded border-2 border-dashed px-3 py-2.5 cursor-pointer transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
            }`}
          >
            {stage ? <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" /> : <Upload className="h-4 w-4 text-primary shrink-0" />}
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium">
                {stage ? STAGE_LABEL[stage] : 'Add bank statements'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                PDF straight from the bank, or .csv / .xlsx export. Drop several months and several accounts at once.
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.csv,.tsv,.xlsx,.xls,.ods,.txt"
              className="hidden"
              onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); }}
            />
          </div>
          <Button variant="outline" className="h-9" onClick={() => setPasteOpen((v) => !v)}>
            <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" /> Paste
          </Button>
          {hasFiles && (
            <Button variant="outline" className="h-9" onClick={clearAll}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear
            </Button>
          )}
        </div>

        {pasteOpen && (
          <div className="mt-3 space-y-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Paste transaction lines, one per line:\n01/05/2026   RAPID FINANCE ACH DEBIT   -1,285.71   12,430.55'}
              className="w-full h-32 rounded border border-border bg-background p-2.5 text-[12px] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button className="h-8" onClick={analyzePaste}>Read these transactions</Button>
          </div>
        )}

        {statements.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {statements.map((s) => (
              <StatementRow
                key={s.id}
                s={s}
                onRemove={() => setStatements((prev) => prev.filter((x) => x.id !== s.id))}
                onApplyMapping={applyMapping}
              />
            ))}
          </div>
        )}

        {file.warnings.map((w, i) => (
          <div key={i} className="mt-2 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/25 p-2.5 text-[12px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{w}</span>
          </div>
        ))}
      </div>

      {/* ── Body ── */}
      {!file.hasData ? (
        <div className="border border-border bg-card rounded-md py-16">
          <div className="mx-auto max-w-xl text-center px-6">
            <div className="mx-auto mb-3 w-fit rounded-lg bg-muted/60 ring-1 ring-border p-3">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-[14px] font-semibold tracking-tight">No statements loaded</div>
            <p className="text-[12.5px] text-muted-foreground mt-1.5 leading-relaxed">
              Drop in the merchant&apos;s statements and the file builds itself: true revenue against gross,
              existing MCA positions and what they cost, negative days from daily balances, NSFs, collection
              activity, and the risk signals a funder will find — every one of them traceable to the transactions
              behind it.
            </p>
          </div>
        </div>
      ) : (
        <>
          {tab === 'overview' && <OverviewPanel {...panelProps} />}
          {tab === 'cashflow' && <CashFlowPanel {...panelProps} />}
          {tab === 'revenue' && <RevenueReviewPanel {...panelProps} />}
          {tab === 'positions' && <PositionsPanel {...panelProps} />}
          {tab === 'transfers' && <TransfersPanel {...panelProps} />}
          {tab === 'risk' && <RiskPanel {...panelProps} />}
          {tab === 'transactions' && <TransactionsPanel {...panelProps} />}
          {tab === 'statements' && <StatementsPanel {...panelProps} />}
        </>
      )}

      {/* ── Mark as MCA ──
          Everything is optional except the name: the underwriter often
          knows the funder but not the original funding, and forcing a
          guessed amount would put a fabricated number into the file. */}
      {mcaDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMcaDraft(null)} aria-hidden />
          <div className="relative w-full max-w-lg bg-card border border-border rounded-lg shadow-xl">
            <header className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-border">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight">Mark as MCA</h3>
                <p className="text-[11.5px] text-muted-foreground mt-0.5">
                  {mcaDraft.txnKeys.length} transaction{mcaDraft.txnKeys.length === 1 ? '' : 's'} selected
                </p>
              </div>
              <button type="button" onClick={() => setMcaDraft(null)} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="p-5 space-y-3">
              <label className="block">
                <span className="block text-[11.5px] text-muted-foreground mb-1">MCA company</span>
                <Input
                  autoFocus
                  value={mcaDraft.funderName}
                  onChange={(e) => setMcaDraft({ ...mcaDraft, funderName: e.target.value })}
                  placeholder="e.g. Reliance Capital"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-[11.5px] text-muted-foreground mb-1">Funding amount (optional)</span>
                  <Input
                    value={mcaDraft.fundingAmount}
                    onChange={(e) => setMcaDraft({ ...mcaDraft, fundingAmount: e.target.value })}
                    placeholder="75,000"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11.5px] text-muted-foreground mb-1">Funding date (optional)</span>
                  <Input
                    type="date"
                    value={mcaDraft.fundingDate}
                    onChange={(e) => setMcaDraft({ ...mcaDraft, fundingDate: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="block text-[11.5px] text-muted-foreground mb-1">Payment amount</span>
                  <Input
                    value={mcaDraft.paymentAmount}
                    onChange={(e) => setMcaDraft({ ...mcaDraft, paymentAmount: e.target.value })}
                    placeholder="Leave blank to use the selected transactions"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11.5px] text-muted-foreground mb-1">Payment frequency</span>
                  <Select
                    value={mcaDraft.cadence}
                    onChange={(e) => setMcaDraft({ ...mcaDraft, cadence: e.target.value as typeof mcaDraft.cadence })}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                  </Select>
                </label>
              </div>

              {mcaDraft.merchantKey && (
                <label className="flex items-start gap-2 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={mcaDraft.applyToAll}
                    onChange={(e) => setMcaDraft({ ...mcaDraft, applyToAll: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    Apply to <span className="font-medium">every transaction from this payee</span>, including ones
                    added later — not just the {mcaDraft.txnKeys.length} selected.
                  </span>
                </label>
              )}

              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                Leave funding blank if you don&apos;t know it — the position will simply read
                &ldquo;funding deposit not detected&rdquo; rather than showing a made-up figure.
              </p>
            </div>

            <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <Button variant="outline" onClick={() => setMcaDraft(null)}>Cancel</Button>
              <Button onClick={saveManualMca}>Add to current MCAs</Button>
            </footer>
          </div>
        </div>
      )}

      <DrillDownPanel drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

/* ───────────────────────── intake row ───────────────────────── */

function StatementRow({
  s, onRemove, onApplyMapping,
}: {
  s: LoadedStatement;
  onRemove: () => void;
  onApplyMapping: (id: string, map: ColumnMap, headerRow: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ok = s.transactions.length > 0 && !s.error;

  return (
    <div className={`rounded border px-2.5 py-2 ${ok ? 'border-border' : 'border-amber-300 bg-amber-50/60 dark:bg-amber-500/10 dark:border-amber-500/30'}`}>
      <div className="flex items-start gap-2.5">
        {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium truncate">{s.fileName}</div>
          <div className="text-[11px] text-muted-foreground">
            {ok ? `${s.transactions.length.toLocaleString()} transactions${s.pageCount ? ` · ${s.pageCount} pages` : ''}` : (s.error || 'Columns could not be detected automatically.')}
          </div>
          {!ok && s.grid && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] font-medium text-primary hover:underline mt-0.5">
              {open ? 'Hide column mapping' : 'Map the columns manually'}
            </button>
          )}
        </div>
        <button type="button" onClick={onRemove} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted shrink-0" aria-label={`Remove ${s.fileName}`}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && s.grid && (
        <ColumnMapper
          grid={s.grid}
          initial={s.detected}
          onApply={(map, headerRow) => { onApplyMapping(s.id, map, headerRow); setOpen(false); }}
        />
      )}
    </div>
  );
}

function ColumnMapper({
  grid, initial, onApply,
}: {
  grid: string[][];
  initial: DetectResult | null;
  onApply: (map: ColumnMap, headerRow: number) => void;
}) {
  const [headerRow, setHeaderRow] = useState(initial?.headerRow ?? 0);
  const [map, setMap] = useState<ColumnMap>(
    initial?.map ?? { date: 0, description: 1, amount: 2, debit: null, credit: null, balance: null, type: null },
  );
  const headers = grid[headerRow] ?? [];
  const width = Math.max(...grid.slice(0, 30).map((r) => r.length), headers.length);
  const options = Array.from({ length: width }, (_, i) => ({
    value: String(i),
    label: `${colLetter(i)} — ${String(headers[i] ?? '').trim() || '(no header)'}`,
  }));

  return (
    <div className="mt-2.5 border-t border-border pt-2.5 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-[11px]">
          <span className="block text-muted-foreground mb-1">Header row</span>
          <Select value={String(headerRow)} onChange={(e) => setHeaderRow(Number(e.target.value))} className="h-8 text-[12px]">
            {grid.slice(0, 15).map((row, i) => (
              <option key={i} value={String(i)}>
                Row {i + 1}: {row.slice(0, 4).map((c) => String(c).trim()).filter(Boolean).join(' | ').slice(0, 36) || '(blank)'}
              </option>
            ))}
          </Select>
        </label>
        {COLUMN_FIELDS.map((f) => (
          <label key={String(f.key)} className="text-[11px]">
            <span className="block text-muted-foreground mb-1">{f.label}{f.required ? '' : ' (optional)'}</span>
            <Select
              value={map[f.key] === null || map[f.key] === undefined ? '' : String(map[f.key])}
              onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
              className="h-8 text-[12px]"
            >
              {!f.required && <option value="">— none —</option>}
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
        ))}
      </div>
      <Button className="h-8" onClick={() => onApply(map, headerRow)}>Use these columns</Button>
    </div>
  );
}

function colLetter(i: number): string {
  let n = i;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
