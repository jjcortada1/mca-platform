'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Card, CardContent,
  Button, Input, Textarea, Field, Badge, PageHeader,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { US_STATES, COMMON_INDUSTRIES, CREDIT_TIER_OPTIONS } from '@/lib/constants';
import { formatCurrency, cn } from '@/lib/utils';
import { Upload, Plus, Search, X, Download, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Contact {
  id?: string;
  name: string;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}

interface Funder {
  id: string;
  name: string;
  submissionMethod: 'email' | 'portal';
  supportsReverseConsolidation: boolean;
  minRevenue: string;
  maxPositions: number;
  minCreditTier: 'unknown' | 'under_550' | '550_599' | '600_649' | '650_plus';
  notes: string | null;
  isActive: boolean;
  contacts: Contact[];
  tiers: { id: string; name: string }[];
  restrictedStates: string[];
  restrictedIndustries: string[];
}

interface FunderTier {
  id: string;
  name: string;
}

const blankFunder = (): Funder => ({
  id: '',
  name: '',
  submissionMethod: 'email',
  supportsReverseConsolidation: false,
  minRevenue: '0',
  maxPositions: 99,
  minCreditTier: 'unknown',
  notes: '',
  isActive: true,
  contacts: [{ name: '', phone: '', email: '', isPrimary: true }],
  tiers: [],
  restrictedStates: [],
  restrictedIndustries: [],
});

export default function FundersPage() {
  const toast = useToast();
  const [funders, setFunders] = useState<Funder[]>([]);
  const [tiers, setTiers] = useState<FunderTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Funder | null>(null);
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);

  async function load() {
    setLoading(true);
    const [fres, tres] = await Promise.all([
      fetch('/api/funders').then((r) => r.json()),
      fetch('/api/funder-tiers').then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    setFunders(fres.data ?? fres ?? []);
    setTiers(tres.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    const body = {
      name: editing.name,
      submissionMethod: editing.submissionMethod,
      supportsReverseConsolidation: editing.supportsReverseConsolidation,
      minRevenue: editing.minRevenue,
      maxPositions: editing.maxPositions,
      minCreditTier: editing.minCreditTier,
      notes: editing.notes,
      isActive: editing.isActive,
      contacts: editing.contacts.filter((c) => c.name.trim() || c.email?.trim()),
      tierIds: editing.tiers.map((t) => t.id),
      restrictedStates: editing.restrictedStates,
      restrictedIndustries: editing.restrictedIndustries,
    };
    const res = editing.id
      ? await fetch(`/api/funders/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      : await fetch('/api/funders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success(editing?.id ? 'Funder updated.' : 'Funder added.');
    setEditing(null);
    load();
  }

  async function deleteFunder(id: string) {
    if (!confirm('Delete this funder? This cannot be undone.')) return;
    await fetch(`/api/funders/${id}`, { method: 'DELETE' });
    load();
  }

  const filtered = funders.filter((f) => {
    if (tierFilter !== 'all' && !f.tiers.some((t) => t.id === tierFilter)) return false;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Funders"
        description="Your funder directory. Used by the deal-shopping engine to match merchants."
        actions={
          <>
            <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-1.5">
              <Upload className="h-4 w-4" /> Bulk import
            </Button>
            <Button onClick={() => setEditing(blankFunder())} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add funder
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setTierFilter('all')}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
            tierFilter === 'all'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
          )}
        >
          <span>All</span>
          <span className={cn(
            'tabular-nums px-1.5 py-0.5 rounded text-[10px]',
            tierFilter === 'all' ? 'bg-primary-foreground/20' : 'bg-muted'
          )}>{funders.length}</span>
        </button>
        {tiers.map((t) => {
          const count = funders.filter((f) => f.tiers.some((x) => x.id === t.id)).length;
          return (
            <button
              key={t.id}
              onClick={() => setTierFilter(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all',
                tierFilter === t.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
              )}
            >
              <span>{t.name}</span>
              <span className={cn(
                'tabular-nums px-1.5 py-0.5 rounded text-[10px]',
                tierFilter === t.id ? 'bg-primary-foreground/20' : 'bg-muted'
              )}>{count}</span>
            </button>
          );
        })}
        <div className="ml-auto relative w-full sm:w-auto sm:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search funders…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="data-grid w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Name</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Tiers</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Min revenue</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Max pos.</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Min credit</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      No funders match your filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((f) => (
                    <tr
                      key={f.id}
                      className="border-b border-border hover:bg-muted/30 cursor-pointer"
                      onClick={() => setEditing(f)}
                    >
                      <td className="px-4 py-3 font-medium">
                        {f.name}
                        {f.supportsReverseConsolidation && (
                          <Badge variant="outline" className="ml-2 text-xs">reverse</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {f.tiers.map((t) => (
                            <Badge key={t.id} variant="outline" className="text-xs">{t.name}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatCurrency(Number(f.minRevenue))}</td>
                      <td className="px-4 py-3 tabular-nums">{f.maxPositions}</td>
                      <td className="px-4 py-3">{CREDIT_TIER_OPTIONS.find((c) => c.value === f.minCreditTier)?.label}</td>
                      <td className="px-4 py-3">
                        {f.isActive ? <Badge variant="success">active</Badge> : <Badge variant="outline">inactive</Badge>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {editing && (
        <FunderDrawer
          funder={editing}
          tiers={tiers}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={editing.id ? () => deleteFunder(editing.id) : undefined}
        />
      )}

      {bulkOpen && (
        <BulkImportModal
          onClose={() => setBulkOpen(false)}
          onComplete={(ok, failed) => {
            setBulkOpen(false);
            if (ok > 0) toast.success(`Imported ${ok} funder${ok === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}.`);
            else if (failed > 0) toast.error(`Import failed for all ${failed} rows. See errors.`);
            load();
          }}
        />
      )}
    </div>
  );
}

function FunderDrawer({
  funder, tiers, onChange, onClose, onSave, onDelete,
}: {
  funder: Funder;
  tiers: FunderTier[];
  onChange: (f: Funder) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  function update<K extends keyof Funder>(k: K, v: Funder[K]) {
    onChange({ ...funder, [k]: v });
  }

  function toggleArrayItem<T extends string>(arr: T[], item: T): T[] {
    return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
  }

  function addContact() {
    onChange({
      ...funder,
      contacts: [...funder.contacts, { name: '', phone: '', email: '', isPrimary: false }],
    });
  }

  function updateContact(idx: number, field: keyof Contact, value: string | boolean) {
    onChange({
      ...funder,
      contacts: funder.contacts.map((c, i) => (i === idx ? { ...c, [field]: value } : c)),
    });
  }

  function removeContact(idx: number) {
    onChange({ ...funder, contacts: funder.contacts.filter((_, i) => i !== idx) });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-background border-l border-border h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold">{funder.id ? 'Edit funder' : 'Add funder'}</h2>
          <div className="flex gap-2">
            {onDelete && <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>}
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={onSave}>Save</Button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <section className="space-y-4">
            <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Details</h3>
            <Field label="Name" required>
              <Input value={funder.name} onChange={(e) => update('name', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min monthly revenue">
                <Input
                  type="number"
                  value={funder.minRevenue}
                  onChange={(e) => update('minRevenue', e.target.value)}
                />
              </Field>
              <Field label="Max positions">
                <Input
                  type="number"
                  value={funder.maxPositions}
                  onChange={(e) => update('maxPositions', parseInt(e.target.value) || 0)}
                />
              </Field>
              <Field label="Min credit tier">
                <select
                  value={funder.minCreditTier}
                  onChange={(e) => update('minCreditTier', e.target.value as Funder['minCreditTier'])}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                >
                  {CREDIT_TIER_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Submission method">
                <select
                  value={funder.submissionMethod}
                  onChange={(e) => update('submissionMethod', e.target.value as Funder['submissionMethod'])}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="email">Email</option>
                  <option value="portal">Portal</option>
                </select>
              </Field>
            </div>
            <div className="flex gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={funder.supportsReverseConsolidation}
                  onChange={(e) => update('supportsReverseConsolidation', e.target.checked)}
                />
                Supports reverse consolidation
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={funder.isActive}
                  onChange={(e) => update('isActive', e.target.checked)}
                />
                Active
              </label>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Tiers</h3>
            {tiers.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tiers defined yet. Create them in Settings.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tiers.map((t) => {
                  const selected = funder.tiers.some((ft) => ft.id === t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        const next = selected
                          ? funder.tiers.filter((ft) => ft.id !== t.id)
                          : [...funder.tiers, t];
                        update('tiers', next);
                      }}
                      className={`px-3 py-1 rounded text-xs ${
                        selected ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Contacts</h3>
              <Button variant="outline" size="sm" onClick={addContact}>+ Add</Button>
            </div>
            {funder.contacts.map((c, i) => (
              <div key={i} className="rounded border border-border p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Name" value={c.name} onChange={(e) => updateContact(i, 'name', e.target.value)} />
                  <Input placeholder="Email" value={c.email ?? ''} onChange={(e) => updateContact(i, 'email', e.target.value)} />
                  <Input placeholder="Phone" value={c.phone ?? ''} onChange={(e) => updateContact(i, 'phone', e.target.value)} />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={c.isPrimary}
                        onChange={(e) => updateContact(i, 'isPrimary', e.target.checked)}
                      />
                      Primary
                    </label>
                    <button
                      onClick={() => removeContact(i)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Restricted states</h3>
            <p className="text-xs text-muted-foreground">Click to toggle. Funder will not match deals from selected states.</p>
            <div className="flex flex-wrap gap-1">
              {US_STATES.map((s) => {
                const selected = funder.restrictedStates.includes(s.code);
                return (
                  <button
                    key={s.code}
                    onClick={() => update('restrictedStates', toggleArrayItem(funder.restrictedStates, s.code))}
                    className={`px-2 py-1 rounded text-xs ${
                      selected ? 'bg-destructive text-destructive-foreground' : 'bg-muted'
                    }`}
                  >
                    {s.code}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Restricted industries</h3>
            <div className="flex flex-wrap gap-1">
              {COMMON_INDUSTRIES.map((ind) => {
                const selected = funder.restrictedIndustries.includes(ind);
                return (
                  <button
                    key={ind}
                    onClick={() => update('restrictedIndustries', toggleArrayItem(funder.restrictedIndustries, ind))}
                    className={`px-2 py-1 rounded text-xs ${
                      selected ? 'bg-destructive text-destructive-foreground' : 'bg-muted'
                    }`}
                  >
                    {ind}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground mb-2">Notes</h3>
            <Textarea
              value={funder.notes ?? ''}
              onChange={(e) => update('notes', e.target.value)}
              rows={4}
              placeholder="Internal notes about this funder…"
            />
          </section>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Bulk Import Modal — CSV upload with template + per-row errors
   ============================================================ */

function BulkImportModal({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: (ok: number, failed: number) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    ok: number;
    failed: number;
    total: number;
    errors: { row: number; message: string }[];
    created: string[];
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFile() {
    fileInputRef.current?.click();
  }

  function onFileChosen(f: File | null) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.csv')) {
      alert('File must be a .csv file.');
      return;
    }
    setFile(f);
    setResult(null);
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/funders/bulk', { method: 'POST', body: fd });
    const json = await res.json();
    setUploading(false);
    if (!res.ok) {
      setResult({ ok: 0, failed: 0, total: 0, errors: [{ row: 0, message: json.error || 'Upload failed' }], created: [] });
      return;
    }
    setResult(json);
    if (json.failed === 0) {
      // Auto-close after brief delay if everything succeeded
      setTimeout(() => onComplete(json.ok, json.failed), 1500);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Bulk import funders</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload a CSV to add many funders at once.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1.5 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Step 1 — download template */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium">Step 1 — Download the template</div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Includes all supported columns and an example row with formatting notes.
                </p>
                <a
                  href="/api/funders/bulk"
                  download="funders_template.csv"
                  className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded text-xs font-medium border border-border bg-card hover:bg-muted transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download template (CSV)
                </a>
              </div>
            </div>
          </div>

          {/* Step 2 — upload */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="text-sm font-medium mb-2">Step 2 — Upload your filled CSV</div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,text/csv"
              onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <div
              onClick={pickFile}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onFileChosen(e.dataTransfer.files?.[0] ?? null);
              }}
              className={cn(
                'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30 hover:bg-card'
              )}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  <Upload className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground/70" />
                  Click to pick a file, or drag & drop a CSV here
                </div>
              )}
            </div>
          </div>

          {/* Format help */}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
              Format requirements
            </summary>
            <ul className="mt-2 pl-4 space-y-1 text-muted-foreground list-disc">
              <li><strong>name</strong> is required for every row.</li>
              <li><strong>tiers</strong>, <strong>restricted_states</strong>, <strong>restricted_industries</strong> use <code className="font-mono bg-muted px-1 rounded">;</code> or <code className="font-mono bg-muted px-1 rounded">|</code> as separators.</li>
              <li><strong>supports_reverse_consolidation</strong> accepts true / false / yes / no / 1 / 0.</li>
              <li><strong>min_credit_tier</strong>: unknown · under_550 · 550_599 · 600_649 · 650_plus</li>
              <li><strong>submission_method</strong>: email or portal</li>
              <li>States: 2-letter codes (CA, NY, etc.)</li>
              <li>Tiers that don&apos;t exist will be created automatically.</li>
              <li>Up to 3 contacts per funder; first is set as primary.</li>
            </ul>
          </details>

          {/* Results */}
          {result && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <div className="text-2xl font-semibold text-emerald-700 tabular-nums">{result.ok}</div>
                  <div className="text-[10px] uppercase tracking-wider text-emerald-700/80 mt-0.5">Imported</div>
                </div>
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-center">
                  <div className="text-2xl font-semibold text-rose-700 tabular-nums">{result.failed}</div>
                  <div className="text-[10px] uppercase tracking-wider text-rose-700/80 mt-0.5">Failed</div>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
                  <div className="text-2xl font-semibold text-foreground tabular-nums">{result.total}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Total rows</div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 max-h-40 overflow-y-auto">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 mb-1.5">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Errors
                  </div>
                  <div className="space-y-0.5 text-xs text-rose-700">
                    {result.errors.map((e, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="font-mono text-rose-700/70 shrink-0">Row {e.row}:</span>
                        <span>{e.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.ok > 0 && result.failed === 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2 text-xs text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  All rows imported successfully. Closing…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
          {result && result.failed > 0 && (
            <Button variant="outline" onClick={() => onComplete(result.ok, result.failed)}>
              Close
            </Button>
          )}
          {!result && (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={upload} disabled={!file || uploading} loading={uploading}>
                Import
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
