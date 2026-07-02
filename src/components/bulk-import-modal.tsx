'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { Download, Upload, X, CheckCircle2 } from 'lucide-react';

/**
 * Reusable CSV bulk-import modal with a preview/confirm step.
 *
 * Flow: download template → pick file → server parses and returns a preview
 * of exactly what will be created (auto-mapped from flexible headers) → user
 * reviews the table → Confirm import commits it. The same endpoint handles
 * both: POST with no `commit` returns the preview; POST with `commit=1`
 * writes the rows.
 */
interface PreviewRow { row: number; valid: boolean; data: Record<string, unknown> }

export function BulkImportModal({
  title,
  endpoint,
  templateUrl,
  columns,
  onClose,
  onComplete,
}: {
  title: string;
  endpoint: string;          // POST target (preview + commit)
  templateUrl: string;       // GET template CSV
  columns: { key: string; label: string }[]; // which data fields to show in preview
  onClose: () => void;
  onComplete: (created: number) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ total: number; valid: number; rows: PreviewRow[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview(f: File) {
    setBusy(true);
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch(endpoint, { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast.error(j.error || 'Could not read the file.'); return; }
    setPreview({ total: j.total, valid: j.valid, rows: j.rows ?? [] });
  }

  function onPick(f: File | null) {
    if (!f) return;
    const ok = /\.(csv)$/i.test(f.name) || f.type === 'text/csv';
    if (!ok) { toast.error('Please upload a .csv file.'); return; }
    setFile(f);
    runPreview(f);
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('commit', '1');
    const res = await fetch(endpoint, { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast.error(j.error || 'Import failed.'); return; }
    toast.success(`Imported ${j.created} row${j.created === 1 ? '' : 's'}${j.failed ? `, ${j.failed} skipped` : ''}.`);
    onComplete(j.created ?? 0);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-card rounded-xl border border-border [box-shadow:var(--shadow-xl)] w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="text-base font-semibold">{title}</div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Step 1 — template */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-sm font-medium mb-1">1. Download the template</div>
            <p className="text-xs text-muted-foreground mb-2">
              Fill it in, then upload. Column names are flexible — the preview shows exactly what will be created.
            </p>
            <a href={templateUrl} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border bg-card hover:bg-muted">
              <Download className="h-3.5 w-3.5" /> Download CSV template
            </a>
          </div>

          {/* Step 2 — upload */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-sm font-medium mb-2">2. Upload your file</div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => onPick(e.target.files?.[0] ?? null)} className="hidden" />
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy} className="gap-1.5">
                <Upload className="h-4 w-4" /> {file ? 'Choose a different file' : 'Choose file'}
              </Button>
              {file && <span className="text-xs text-muted-foreground truncate">{file.name}</span>}
            </div>
          </div>

          {/* Step 3 — preview */}
          {busy && !preview && <div className="text-sm text-muted-foreground">Reading file…</div>}
          {preview && (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">3. Review — {preview.valid} of {preview.total} rows ready</div>
                {preview.total > preview.valid && (
                  <span className="text-xs text-amber-700">{preview.total - preview.valid} row(s) missing required fields will be skipped</span>
                )}
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto rounded border border-border/60">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-semibold">#</th>
                      {columns.map((c) => <th key={c.key} className="text-left px-2 py-1.5 font-semibold whitespace-nowrap">{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {preview.rows.map((r) => (
                      <tr key={r.row} className={r.valid ? '' : 'opacity-40'}>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.row}</td>
                        {columns.map((c) => (
                          <td key={c.key} className="px-2 py-1.5 whitespace-nowrap">{fmtCell(r.data[c.key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={commit} disabled={busy || !preview || preview.valid === 0} className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> {busy ? 'Importing…' : `Confirm import (${preview?.valid ?? 0})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function fmtCell(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}
