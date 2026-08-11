'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Card, CardContent, Button, Input, PageHeader, Badge, Select,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import {
  Upload, CheckCircle2, XCircle, AlertTriangle, Download, Copy,
  Trash2, Info, ClipboardPaste, Loader2, ShieldCheck, TrendingUp, TrendingDown,
  Activity, Gauge, X,
} from 'lucide-react';
import {
  detectColumns, detectColumnsHeaderless, gridToTransactions, parseStatementText,
  mergeTransactions,
} from '@/lib/underwriting/parse';
import { extractPdfText } from '@/lib/underwriting/pdf';
import type { Transaction, DetectResult, ColumnMap } from '@/lib/underwriting/parse';
import {
  analyzeStatements, reportToText, fmtMoney, fmtMoneyShort, fmtStatementDate, CADENCE_LABEL,
} from '@/lib/underwriting/engine';
import type { UnderwritingReport, McaPosition } from '@/lib/underwriting/engine';

/**
 * Underwriting — bank-statement scrub.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Runs entirely in the browser on plain code. No AI, no API credits, no
 * upload: the statement file is read with FileReader, parsed locally, and
 * never touches the server or the database. Close the tab and the data is
 * gone.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The analysis itself lives in src/lib/underwriting/ — this file is the
 * dashboard that renders it.
 */

type Mode = 'upload' | 'paste';

interface FileEntry {
  id: string;
  name: string;
  /** Parsed spreadsheet grid, kept so column mapping can be redone. */
  grid: string[][] | null;
  detected: DetectResult | null;
  transactions: Transaction[];
  skipped: number;
  warnings: string[];
  error: string | null;
  /** True when auto-detection failed and the user must map columns. */
  needsMapping: boolean;
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

export function UnderwritingScrub() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xlsxRef = useRef<any>(null);

  const [mode, setMode] = useState<Mode>('upload');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showAllTxns, setShowAllTxns] = useState(false);

  /* ─────────────────────────── parsing ─────────────────────────── */

  const parseGridFile = useCallback(async (file: File): Promise<FileEntry> => {
    const base: FileEntry = {
      id: newId(), name: file.name, grid: null, detected: null,
      transactions: [], skipped: 0, warnings: [], error: null, needsMapping: false,
    };
    try {
      if (!xlsxRef.current) xlsxRef.current = await import('xlsx');
      const XLSX = xlsxRef.current;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) return { ...base, error: 'That file has no sheets in it.' };

      const grid: string[][] = XLSX.utils
        .sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' })
        .map((r: any[]) => (Array.isArray(r) ? r.map((v) => (v == null ? '' : String(v))) : []));

      const detected = detectColumns(grid) ?? detectColumnsHeaderless(grid);
      if (!detected) {
        return { ...base, grid, error: null, needsMapping: true };
      }
      const parsed = gridToTransactions(grid, detected, { source: file.name });
      if (!parsed.transactions.length) {
        return { ...base, grid, detected, needsMapping: true, error: 'No transactions could be read with the detected columns.' };
      }
      return {
        ...base, grid, detected,
        transactions: parsed.transactions,
        skipped: parsed.skipped,
        warnings: parsed.warnings,
      };
    } catch {
      return { ...base, error: 'Could not read that file. Export it from your bank as .csv or .xlsx and try again.' };
    }
  }, []);

  const parseTextFile = useCallback(async (file: File): Promise<FileEntry> => {
    const text = await file.text();
    const parsed = parseStatementText(text, { source: file.name });
    return {
      id: newId(), name: file.name, grid: null, detected: null,
      transactions: parsed.transactions, skipped: parsed.skipped,
      warnings: parsed.warnings,
      error: parsed.transactions.length ? null : 'No transaction lines were recognized in that text file.',
      needsMapping: false,
    };
  }, []);

  /**
   * PDF statements — the format banks actually hand out. pdf.js pulls the
   * text layer out in the browser, the rows are rebuilt from the fragment
   * positions, and the result goes through the same line parser as pasted
   * text. Nothing is uploaded.
   */
  const parsePdfFile = useCallback(async (file: File): Promise<FileEntry> => {
    const base: FileEntry = {
      id: newId(), name: file.name, grid: null, detected: null,
      transactions: [], skipped: 0, warnings: [], error: null, needsMapping: false,
    };
    try {
      const buf = await file.arrayBuffer();
      const extracted = await extractPdfText(buf);

      if (!extracted.hasTextLayer) {
        return {
          ...base,
          error:
            'That PDF is a scan — it holds page images, not text, so there is nothing to read. Ask the merchant for the statement downloaded straight from online banking (not a photo or a scan), or use the CSV export.',
        };
      }

      const parsed = parseStatementText(extracted.text, { source: file.name });
      if (!parsed.transactions.length) {
        return {
          ...base,
          error: `Read ${extracted.pageCount} page${extracted.pageCount === 1 ? '' : 's'} of text but found no transaction rows. This bank's layout may be unusual — try the CSV export, or paste the transaction lines on the Paste tab.`,
        };
      }
      return {
        ...base,
        transactions: parsed.transactions,
        skipped: parsed.skipped,
        warnings: parsed.warnings,
      };
    } catch {
      return {
        ...base,
        error: 'Could not open that PDF. If it is password-protected, remove the password and try again.',
      };
    }
  }, []);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setBusy(true);
    try {
      const results: FileEntry[] = [];
      for (const f of incoming) {
        if (/\.pdf$/i.test(f.name)) results.push(await parsePdfFile(f));
        else if (/\.(txt|text)$/i.test(f.name)) results.push(await parseTextFile(f));
        else results.push(await parseGridFile(f));
      }
      setFiles((prev) => [...prev, ...results]);
      const good = results.filter((r) => r.transactions.length).length;
      const total = results.reduce((s, r) => s + r.transactions.length, 0);
      if (good) toast.success(`Read ${total.toLocaleString()} transactions from ${good} file${good === 1 ? '' : 's'}.`);
      const bad = results.filter((r) => r.error || r.needsMapping);
      if (bad.length) toast.error(`${bad.length} file${bad.length === 1 ? '' : 's'} need${bad.length === 1 ? 's' : ''} attention below.`);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [parseGridFile, parseTextFile, parsePdfFile, toast]);

  function analyzePaste() {
    const text = pasteText.trim();
    if (!text) { toast.error('Paste the transaction lines from the statement first.'); return; }
    const parsed = parseStatementText(text, { source: 'Pasted text' });
    if (!parsed.transactions.length) {
      toast.error('No transaction lines were recognized. Each line needs a date, a description, and an amount.');
      return;
    }
    setFiles((prev) => [...prev, {
      id: newId(), name: `Pasted text (${parsed.transactions.length} rows)`, grid: null, detected: null,
      transactions: parsed.transactions, skipped: parsed.skipped, warnings: parsed.warnings,
      error: null, needsMapping: false,
    }]);
    setPasteText('');
    toast.success(`Read ${parsed.transactions.length.toLocaleString()} transactions.`);
  }

  /** Re-parse one file after the user maps its columns by hand. */
  function applyMapping(fileId: string, map: ColumnMap, headerRow: number) {
    setFiles((prev) => prev.map((f) => {
      if (f.id !== fileId || !f.grid) return f;
      const detected: DetectResult = { headerRow, headers: f.grid[headerRow] ?? [], map };
      const parsed = gridToTransactions(f.grid, detected, { source: f.name });
      if (!parsed.transactions.length) {
        toast.error('Still no transactions with those columns — double-check the date and amount picks.');
        return { ...f, detected, error: 'No transactions could be read with those columns.' };
      }
      toast.success(`Read ${parsed.transactions.length.toLocaleString()} transactions from ${f.name}.`);
      return {
        ...f, detected, transactions: parsed.transactions, skipped: parsed.skipped,
        warnings: parsed.warnings, error: null, needsMapping: false,
      };
    }));
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function clearAll() {
    setFiles([]);
    setPasteText('');
    setShowAllTxns(false);
  }

  /* ─────────────────────────── analysis ─────────────────────────── */

  const report: UnderwritingReport = useMemo(() => {
    const sets = files.filter((f) => f.transactions.length).map((f) => f.transactions);
    const warnings = Array.from(new Set(files.flatMap((f) => f.warnings)));
    if (!sets.length) return analyzeStatements([], warnings);
    return analyzeStatements(mergeTransactions(sets), warnings);
  }, [files]);

  const summaryText = useMemo(
    () => reportToText(report, merchantName.trim() || undefined),
    [report, merchantName],
  );

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText);
      toast.success('Scrub summary copied.');
    } catch {
      toast.error('Copy failed — your browser blocked clipboard access.');
    }
  }

  function downloadReport() {
    const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (merchantName.trim() || 'underwriting-scrub').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    a.href = url;
    a.download = `${slug || 'underwriting-scrub'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const hasFiles = files.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Underwriting"
        title="Underwriting Summary"
        description="Drop in bank statements and get an instant MCA scrub — existing positions, cash-flow health, and the red flags a funder will hit. Runs on local code in your browser: no AI credits, and the statements are never uploaded anywhere."
        actions={
          hasFiles && report.hasData ? (
            <>
              <Button variant="outline" onClick={copySummary}>
                <Copy className="h-4 w-4 mr-2" /> Copy summary
              </Button>
              <Button onClick={downloadReport}>
                <Download className="h-4 w-4 mr-2" /> Download report
              </Button>
            </>
          ) : undefined
        }
      />

      {/* ── Intake ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => setMode('upload')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === 'upload' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Upload PDF or CSV
              </button>
              <button
                type="button"
                onClick={() => setMode('paste')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === 'paste' ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Paste text
              </button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Input
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                placeholder="Merchant name (optional)"
                className="h-9 w-56"
              />
              {hasFiles && (
                <Button variant="outline" onClick={clearAll} className="h-9">
                  <Trash2 className="h-4 w-4 mr-2" /> Clear
                </Button>
              )}
            </div>
          </div>

          {mode === 'upload' ? (
            <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`flex items-center gap-4 rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors ${
                  dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
                }`}
              >
                <div className="rounded-xl bg-primary/10 p-3 shrink-0">
                  {busy ? <Loader2 className="h-6 w-6 text-primary animate-spin" /> : <Upload className="h-6 w-6 text-primary" />}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold">Upload bank statements</div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    Drag &amp; drop here, or click to browse. Add all three months at once.
                  </div>
                  <div className="text-xs text-muted-foreground/80 mt-1">
                    <span className="font-medium text-foreground">PDF statements straight from the bank</span>, plus
                    .csv, .xlsx, .xls, .tsv, and .txt exports.
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

              <div className="space-y-2">
                {files.length === 0 ? (
                  <div className="h-full rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground flex items-center">
                    <span>
                      No statements loaded yet. Drop in the merchant&apos;s PDF statements exactly as the bank issued
                      them — one per month. A CSV export works too and is slightly more precise, since it always
                      carries a running balance. Scanned or photographed statements have no text in them and
                      can&apos;t be read.
                    </span>
                  </div>
                ) : (
                  files.map((f) => (
                    <FileRow key={f.id} file={f} onRemove={() => removeFile(f.id)} onApplyMapping={applyMapping} />
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
              <div className="space-y-2">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'Fallback for when a PDF will not read. Paste the transaction lines, one per line:\n\n01/05/2026   RAPID FINANCE ACH DEBIT      -1,285.71    12,430.55\n01/06/2026   CUSTOMER DEPOSIT              4,820.00    17,250.55'}
                  className="w-full h-44 rounded-lg border border-border bg-background p-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex items-center gap-2">
                  <Button onClick={analyzePaste}>
                    <ClipboardPaste className="h-4 w-4 mr-2" /> Read these transactions
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Each line needs a date, a description, and an amount; a trailing running balance is used when
                    present. Section headings like &ldquo;Electronic Withdrawals&rdquo; are honored, so paste them too.
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                {files.map((f) => (
                  <FileRow key={f.id} file={f} onRemove={() => removeFile(f.id)} onApplyMapping={applyMapping} />
                ))}
              </div>
            </div>
          )}

          {report.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {!report.hasData ? (
        <Card>
          <CardContent className="py-14">
            <div className="mx-auto max-w-2xl text-center">
              <div className="mx-auto mb-4 w-fit rounded-2xl bg-muted/60 ring-1 ring-border p-3.5">
                <ShieldCheck className="h-6 w-6 text-muted-foreground/80" />
              </div>
              <div className="text-[15px] font-semibold tracking-tight">Nothing scrubbed yet</div>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                Load a statement above and the scrub runs instantly. It looks for recurring daily and weekly
                debits, matches them against a dictionary of known MCA funders, reverse-solves the likely
                advance behind each one, and grades the file against the standard underwriting box.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3 text-left">
                {[
                  { icon: Activity, t: 'Position detection', d: 'Finds stacked advances by funder name and by fixed-amount daily/weekly cadence.' },
                  { icon: Gauge, t: 'Cash-flow read', d: 'Deposits, true revenue, NSFs, negative days, and average daily balance per month.' },
                  { icon: ShieldCheck, t: 'Local + private', d: 'PDFs are read and analyzed in your browser. Statements are never uploaded or stored.' },
                ].map((x) => (
                  <div key={x.t} className="rounded-xl border border-border p-4">
                    <x.icon className="h-4 w-4 text-muted-foreground mb-2" />
                    <div className="text-sm font-medium">{x.t}</div>
                    <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{x.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr,360px] items-start">
          {/* ── Main column ─────────────────────────────────── */}
          <div className="space-y-6 min-w-0">
            <KeyMetrics report={report} />
            <McaDetection report={report} />
            <CashFlowChart report={report} />
            <ScrubChecklist report={report} />
            <MonthTable report={report} />
          </div>

          {/* ── Right rail ──────────────────────────────────── */}
          <div className="space-y-6 xl:sticky xl:top-4">
            <OverallResult report={report} />
            <McaSummary report={report} />
            <RiskPanel report={report} />
            <RecentMcaTransactions
              report={report}
              showAll={showAllTxns}
              onToggle={() => setShowAllTxns((v) => !v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════ sub-components ══════════════════════════ */

function FileRow({
  file, onRemove, onApplyMapping,
}: {
  file: FileEntry;
  onRemove: () => void;
  onApplyMapping: (id: string, map: ColumnMap, headerRow: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ok = file.transactions.length > 0 && !file.error;

  return (
    <div className={`rounded-xl border p-3 ${ok ? 'border-border bg-card' : 'border-amber-200 bg-amber-50/60'}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          {ok
            ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            : <AlertTriangle className="h-5 w-5 text-amber-600" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{file.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {ok
              ? `${file.transactions.length.toLocaleString()} transactions read${file.skipped ? ` · ${file.skipped} lines skipped` : ''}`
              : file.error || 'Columns could not be detected automatically.'}
          </div>
          {!ok && file.grid && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-xs font-medium text-primary hover:underline mt-1"
            >
              {open ? 'Hide column mapping' : 'Map the columns manually'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label={`Remove ${file.name}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {open && file.grid && (
        <ColumnMapper
          grid={file.grid}
          initial={file.detected}
          onApply={(map, headerRow) => { onApplyMapping(file.id, map, headerRow); setOpen(false); }}
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
    <div className="mt-3 border-t border-border pt-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          <span className="block text-muted-foreground mb-1">Header row</span>
          <Select
            value={String(headerRow)}
            onChange={(e) => setHeaderRow(Number(e.target.value))}
            className="h-9 text-sm"
          >
            {grid.slice(0, 15).map((row, i) => (
              <option key={i} value={String(i)}>
                Row {i + 1}: {row.slice(0, 4).map((c) => String(c).trim()).filter(Boolean).join(' | ').slice(0, 40) || '(blank)'}
              </option>
            ))}
          </Select>
        </label>
        {COLUMN_FIELDS.map((f) => (
          <label key={String(f.key)} className="text-xs">
            <span className="block text-muted-foreground mb-1">
              {f.label}{f.required ? '' : ' (optional)'}
            </span>
            <Select
              value={map[f.key] === null || map[f.key] === undefined ? '' : String(map[f.key])}
              onChange={(e) =>
                setMap((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))
              }
              className="h-9 text-sm"
            >
              {!f.required && <option value="">— none —</option>}
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
        ))}
      </div>
      <Button
        className="h-9"
        onClick={() => onApply(map, headerRow)}
      >
        Use these columns
      </Button>
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

function KeyMetrics({ report }: { report: UnderwritingReport }) {
  const metrics = [
    {
      label: 'Avg monthly deposits',
      value: fmtMoneyShort(report.avgMonthlyDeposits),
      sub: `${report.avgDepositCount.toFixed(1)} deposits per month`,
      tone: 'neutral' as const,
    },
    {
      label: 'Avg monthly withdrawals',
      value: fmtMoneyShort(report.avgMonthlyWithdrawals),
      sub: `${fmtMoneyShort(report.totalMonthlyMca)} of that is MCA debits`,
      tone: 'neutral' as const,
    },
    {
      label: 'Monthly net cash flow',
      value: fmtMoneyShort(report.avgMonthlyNet),
      sub: report.avgMonthlyNet >= 0 ? 'Deposits exceed withdrawals' : 'Burning cash each month',
      tone: report.avgMonthlyNet >= 0 ? ('good' as const) : ('bad' as const),
    },
    {
      label: 'Cash flow score',
      value: `${report.score} / 100`,
      sub: report.grade === 'Decline' ? 'Likely decline' : `Grade ${report.grade}`,
      tone: report.score >= 70 ? ('good' as const) : report.score >= 55 ? ('warn' as const) : ('bad' as const),
    },
  ];

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Key metrics</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{m.label}</div>
              <div className={`text-2xl font-semibold tracking-tight mt-2 tabular-nums ${
                m.tone === 'good' ? 'text-emerald-600' : m.tone === 'bad' ? 'text-rose-600' : m.tone === 'warn' ? 'text-amber-600' : ''
              }`}>
                {m.value}
              </div>
              <div className="text-xs text-muted-foreground mt-1.5 leading-snug">{m.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ConfidenceChip({ level }: { level: McaPosition['confidence'] }) {
  const variant = level === 'high' ? 'destructive' : level === 'medium' ? 'warning' : 'default';
  const label = level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Low';
  return <Badge variant={variant as any}>{label}</Badge>;
}

function McaDetection({ report }: { report: UnderwritingReport }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const any = report.positions.length > 0;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">MCA detection</h2>
          <span className="text-xs text-muted-foreground">
            {report.transactionCount.toLocaleString()} transactions · {fmtStatementDate(report.periodStart)} – {fmtStatementDate(report.periodEnd)}
          </span>
        </div>

        <div className={`flex items-center gap-3 rounded-lg border p-3 ${
          any ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'
        }`}>
          {any
            ? <XCircle className="h-5 w-5 text-rose-600 shrink-0" />
            : <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />}
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${any ? 'text-rose-700' : 'text-emerald-700'}`}>
              {any ? 'MCAs DETECTED' : 'NO MCAs DETECTED'}
            </div>
            <div className={`text-xs mt-0.5 ${any ? 'text-rose-600' : 'text-emerald-600'}`}>
              {any
                ? `${report.positionCount} active position${report.positionCount === 1 ? '' : 's'}${report.positions.length > report.positionCount ? ` · ${report.positions.length - report.positionCount} appear paid off` : ''}`
                : 'No recurring daily or weekly advance debits found in these statements'}
            </div>
          </div>
        </div>

        {any ? (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-semibold">Funder</th>
                  <th className="py-2 px-3 font-semibold text-right">Payment</th>
                  <th className="py-2 px-3 font-semibold text-right">Per day</th>
                  <th className="py-2 px-3 font-semibold text-right">Est. original advance</th>
                  <th className="py-2 px-3 font-semibold text-right">Est. balance left</th>
                  <th className="py-2 pl-3 font-semibold text-right">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {report.positions.map((p) => (
                  <PositionRow
                    key={p.id}
                    position={p}
                    expanded={expanded === p.id}
                    onToggle={() => setExpanded((cur) => (cur === p.id ? null : p.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing in these statements repeats on the fixed daily or weekly schedule an advance debits on, and no
            known funder names appear. If the merchant has an advance being paid by a method that never hits this
            account, it will not show up here.
          </p>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Advance size, factor, and remaining balance are reverse-solved from the payment amount and cadence using
            the same engine as the Reverse Calculator. They are estimates — a payoff letter is the only exact number.
            Balance left only shows when the advance visibly started inside the uploaded statement window.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function PositionRow({
  position: p, expanded, onToggle,
}: {
  position: McaPosition;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-border/70 cursor-pointer hover:bg-muted/40 transition-colors"
      >
        <td className="py-3 pr-3">
          <div className="font-medium flex items-center gap-2">
            {p.funderName}
            {!p.identified && <Badge variant="outline">Unrecognized name</Badge>}
            {p.likelyPaidOff && <Badge variant="success">Paid off / stopped</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {CADENCE_LABEL[p.cadence]} · {p.paymentCount} debits · {fmtStatementDate(p.firstDate)} – {fmtStatementDate(p.lastDate)}
          </div>
        </td>
        <td className="py-3 px-3 text-right tabular-nums">{fmtMoney(p.paymentAmount)}</td>
        <td className="py-3 px-3 text-right tabular-nums">{fmtMoney(p.dailyEquivalent)}</td>
        <td className="py-3 px-3 text-right tabular-nums">
          {p.estimatedFunding ? fmtMoneyShort(p.estimatedFunding) : '—'}
        </td>
        <td className="py-3 px-3 text-right tabular-nums">
          {p.estimatedRemaining !== null ? (
            <>
              {fmtMoneyShort(p.estimatedRemaining)}
              {p.estimatedRemainingPct !== null && (
                <span className="text-muted-foreground"> ({Math.round(p.estimatedRemainingPct * 100)}%)</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Started earlier</span>
          )}
        </td>
        <td className="py-3 pl-3 text-right"><ConfidenceChip level={p.confidence} /></td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/70 bg-muted/20">
          <td colSpan={6} className="py-3 px-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1.5">
                  Why this was flagged
                </div>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {p.confidenceReasons.map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mt-3 mb-1">
                  Bank descriptor
                </div>
                <div className="text-xs font-mono break-all text-muted-foreground">{p.descriptor}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1.5">
                  Reverse-solved structure
                </div>
                <dl className="text-xs space-y-1">
                  <Row label="Estimated funding" value={p.estimatedFunding ? fmtMoneyShort(p.estimatedFunding) : 'Not solvable'} />
                  <Row label="Estimated factor" value={p.estimatedFactor ? p.estimatedFactor.toFixed(2) : '—'} />
                  <Row label="Estimated term" value={p.estimatedTermWeeks ? `${p.estimatedTermWeeks} weeks` : '—'} />
                  <Row label="Estimated total payback" value={p.estimatedPayback ? fmtMoneyShort(p.estimatedPayback) : '—'} />
                  <Row label="Debited so far (in these statements)" value={fmtMoneyShort(p.totalDebited)} />
                  <Row label="Monthly burden" value={fmtMoneyShort(p.monthlyEquivalent)} />
                </dl>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums font-medium">{value}</dd>
    </div>
  );
}

function CashFlowChart({ report }: { report: UnderwritingReport }) {
  const months = report.months.slice(-12);
  if (!months.length) return null;

  const max = Math.max(1, ...months.map((m) => Math.max(m.deposits, m.withdrawals)));
  const H = 180;
  const W = Math.max(360, months.length * 90);
  const slot = W / months.length;
  const barW = Math.min(22, slot / 3.4);
  const y = (v: number) => H - (Math.max(0, v) / max) * H;

  const netMin = Math.min(0, ...months.map((m) => m.net));
  const netMax = Math.max(1, ...months.map((m) => m.net));
  const netY = (v: number) => H - ((v - netMin) / (netMax - netMin || 1)) * H;

  const linePoints = months
    .map((m, i) => `${(i + 0.5) * slot},${netY(m.net)}`)
    .join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold tracking-tight">
            Cash flow overview{' '}
            <span className="font-normal text-muted-foreground text-sm">
              ({months.length} month{months.length === 1 ? '' : 's'})
            </span>
          </h2>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Deposits</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Withdrawals</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-sky-500" /> Net</span>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex flex-col justify-between text-[10px] text-muted-foreground tabular-nums py-1" style={{ height: H + 8 }}>
            {[...ticks].reverse().map((t) => <span key={t}>{fmtMoneyShort(max * t)}</span>)}
          </div>
          <div className="flex-1 overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H + 26}`} width="100%" height={H + 26} preserveAspectRatio="none" role="img" aria-label="Monthly deposits, withdrawals and net cash flow">
              {ticks.map((t) => (
                <line key={t} x1={0} x2={W} y1={H - t * H} y2={H - t * H} stroke="currentColor" strokeWidth={1} className="text-border" />
              ))}
              {months.map((m, i) => {
                const cx = (i + 0.5) * slot;
                return (
                  <g key={m.key}>
                    <rect
                      x={cx - barW - 2} y={y(m.deposits)} width={barW} height={Math.max(1, H - y(m.deposits))}
                      className="fill-emerald-500" rx={2}
                    >
                      <title>{`${m.label} deposits: ${fmtMoneyShort(m.deposits)}`}</title>
                    </rect>
                    <rect
                      x={cx + 2} y={y(m.withdrawals)} width={barW} height={Math.max(1, H - y(m.withdrawals))}
                      className="fill-rose-500" rx={2}
                    >
                      <title>{`${m.label} withdrawals: ${fmtMoneyShort(m.withdrawals)}`}</title>
                    </rect>
                    <text x={cx} y={H + 18} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>
                      {m.label}
                    </text>
                  </g>
                );
              })}
              {months.length > 1 && (
                <polyline points={linePoints} fill="none" strokeWidth={2} className="stroke-sky-500" />
              )}
              {months.map((m, i) => (
                <circle key={`p-${m.key}`} cx={(i + 0.5) * slot} cy={netY(m.net)} r={3} className="fill-sky-500">
                  <title>{`${m.label} net: ${fmtMoneyShort(m.net)}`}</title>
                </circle>
              ))}
            </svg>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScrubChecklist({ report }: { report: UnderwritingReport }) {
  const STATUS: Record<string, { cls: string; label: string }> = {
    pass: { cls: 'text-emerald-600', label: 'Pass' },
    warn: { cls: 'text-amber-600', label: 'Watch' },
    fail: { cls: 'text-rose-600', label: 'Fail' },
    unknown: { cls: 'text-muted-foreground', label: 'No data' },
  };
  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-base font-semibold tracking-tight mb-4">Underwriting box</h2>
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {report.checks.map((c) => {
            const s = STATUS[c.status];
            return (
              <div key={c.label} className="flex items-center justify-between gap-3 py-2 border-b border-border/60">
                <div className="min-w-0">
                  <div className="text-sm truncate">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.benchmark}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium tabular-nums">{c.value}</div>
                  <div className={`text-xs font-medium ${s.cls}`}>{s.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MonthTable({ report }: { report: UnderwritingReport }) {
  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-base font-semibold tracking-tight mb-4">Month by month</h2>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-semibold">Month</th>
                <th className="py-2 px-3 font-semibold text-right">Deposits</th>
                <th className="py-2 px-3 font-semibold text-right">#</th>
                <th className="py-2 px-3 font-semibold text-right">True revenue</th>
                <th className="py-2 px-3 font-semibold text-right">Withdrawals</th>
                <th className="py-2 px-3 font-semibold text-right">MCA debits</th>
                <th className="py-2 px-3 font-semibold text-right">NSF</th>
                <th className="py-2 px-3 font-semibold text-right">Neg. days</th>
                <th className="py-2 pl-3 font-semibold text-right">Avg balance</th>
              </tr>
            </thead>
            <tbody>
              {report.months.map((m) => (
                <tr key={m.key} className="border-b border-border/60">
                  <td className="py-2.5 pr-3 font-medium">{m.label}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmtMoneyShort(m.deposits)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{m.depositCount}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmtMoneyShort(m.trueRevenue)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmtMoneyShort(m.withdrawals)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{m.mcaDebits > 0 ? fmtMoneyShort(m.mcaDebits) : '—'}</td>
                  <td className={`py-2.5 px-3 text-right tabular-nums ${m.nsfCount > 0 ? 'text-rose-600 font-medium' : 'text-muted-foreground'}`}>{m.nsfCount}</td>
                  <td className={`py-2.5 px-3 text-right tabular-nums ${m.negativeDays > 0 ? 'text-rose-600 font-medium' : 'text-muted-foreground'}`}>
                    {report.balancesAvailable ? m.negativeDays : '—'}
                  </td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">
                    {m.avgDailyBalance !== null ? fmtMoneyShort(m.avgDailyBalance) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!report.balancesAvailable && (
          <p className="text-xs text-muted-foreground mt-3">
            The statements had no running-balance column, so negative days and average daily balance could not be
            measured. Re-export with the balance column to fill those in.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function OverallResult({ report }: { report: UnderwritingReport }) {
  const good = report.grade === 'A' || report.grade === 'B';
  const bad = report.grade === 'D' || report.grade === 'Decline';
  const tone = good ? 'emerald' : bad ? 'rose' : 'amber';
  const toneText = good ? 'text-emerald-600' : bad ? 'text-rose-600' : 'text-amber-600';
  const toneRing = good ? 'ring-emerald-200 bg-emerald-50' : bad ? 'ring-rose-200 bg-rose-50' : 'ring-amber-200 bg-amber-50';

  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Overall result</div>
        <div className="flex items-start justify-between gap-3 mt-2">
          <div className="min-w-0">
            <div className={`text-2xl font-semibold tracking-tight ${toneText}`}>{report.verdict}</div>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{report.verdictDetail}</p>
          </div>
          <div className={`shrink-0 rounded-full ring-2 ${toneRing} h-14 w-14 flex items-center justify-center`}>
            <span className={`text-xl font-semibold ${toneText}`}>{report.grade}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Score</div>
            <div className={`text-lg font-semibold tabular-nums ${toneText}`}>{report.score}/100</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Statements</div>
            <div className="text-lg font-semibold tabular-nums">{report.monthsCovered} mo</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Room for new money</div>
          <div className="text-xl font-semibold tabular-nums mt-1">{fmtMoneyShort(report.maxNewAdvance)}</div>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{report.maxNewAdvanceBasis}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function McaSummary({ report }: { report: UnderwritingReport }) {
  const rows: { label: string; value: string; tone?: 'bad' }[] = [
    { label: 'Total active MCAs', value: String(report.positionCount), tone: report.positionCount >= 3 ? 'bad' : undefined },
    { label: 'Total daily ACH', value: fmtMoney(report.totalDailyMca), tone: report.totalDailyMca > 0 ? 'bad' : undefined },
    { label: 'Total monthly ACH', value: fmtMoneyShort(report.totalMonthlyMca), tone: report.totalMonthlyMca > 0 ? 'bad' : undefined },
    { label: 'Est. total payback', value: report.totalEstimatedPayback > 0 ? fmtMoneyShort(report.totalEstimatedPayback) : '—' },
    { label: 'MCA % of deposits', value: `${(report.holdbackPct * 100).toFixed(1)}%`, tone: report.holdbackPct > 0.2 ? 'bad' : undefined },
  ];
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-base font-semibold tracking-tight mb-3">Detected MCA summary</h3>
        <div className="space-y-0">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60 last:border-0">
              <span className="text-sm text-muted-foreground">{r.label}</span>
              <span className={`text-sm font-semibold tabular-nums ${r.tone === 'bad' ? 'text-rose-600' : ''}`}>{r.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RiskPanel({ report }: { report: UnderwritingReport }) {
  if (!report.redFlags.length && !report.positives.length) return null;
  const ICON = {
    critical: <XCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />,
    info: <Info className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />,
  };
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        {report.redFlags.length > 0 && (
          <div>
            <h3 className="text-base font-semibold tracking-tight mb-3 flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-rose-600" /> Red flags
            </h3>
            <ul className="space-y-2.5">
              {report.redFlags.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  {ICON[f.severity]}
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted-foreground leading-relaxed">{f.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {report.positives.length > 0 && (
          <div className={report.redFlags.length ? 'pt-4 border-t border-border' : ''}>
            <h3 className="text-base font-semibold tracking-tight mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" /> Strengths
            </h3>
            <ul className="space-y-1.5">
              {report.positives.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground leading-relaxed">{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentMcaTransactions({
  report, showAll, onToggle,
}: {
  report: UnderwritingReport;
  showAll: boolean;
  onToggle: () => void;
}) {
  if (!report.recentMcaTransactions.length) return null;
  const rows = showAll ? report.recentMcaTransactions : report.recentMcaTransactions.slice(0, 8);
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-base font-semibold tracking-tight mb-3">Recent MCA debits</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground border-b border-border">
              <th className="py-1.5 pr-2 font-semibold">Date</th>
              <th className="py-1.5 px-2 font-semibold">Description</th>
              <th className="py-1.5 pl-2 font-semibold text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={`${t.date}-${i}`} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-2 whitespace-nowrap text-muted-foreground">{fmtStatementDate(t.date)}</td>
                <td className="py-2 px-2 truncate max-w-[150px]" title={t.description}>{t.description}</td>
                <td className="py-2 pl-2 text-right tabular-nums text-rose-600 whitespace-nowrap">
                  −{fmtMoney(Math.abs(t.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {report.recentMcaTransactions.length > 8 && (
          <Button variant="outline" className="w-full mt-3 h-9" onClick={onToggle}>
            {showAll ? 'Show fewer' : `View all ${report.recentMcaTransactions.length}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
