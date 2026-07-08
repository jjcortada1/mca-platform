'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Card, CardContent,
  Button, Input, Textarea, Field, Badge, PageHeader, MoneyInput, TableSkeleton } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-provider';
import { US_STATES, COMMON_INDUSTRIES, CREDIT_TIER_OPTIONS } from '@/lib/constants';
import { formatCurrency, cn } from '@/lib/utils';
import { Upload, Plus, Search, X, Download, FileText, AlertCircle, CheckCircle2, Trash2, Eye, Phone, Mail } from 'lucide-react';
import { exportCSV } from '@/lib/csv-export';

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
  // When true, the email subject sent to this funder skips the invisible
  // thread-breaker characters (Unicode). Use for legacy intake CRMs.
  plainSubjectOnly?: boolean;
  // Multi-value submission emails — used when shopping deals to this funder.
  emails?: string[] | null;
  // Multi-value phones (display-only).
  phones?: string[] | null;
  contacts: Contact[];
  tiers: {
    id: string;
    name: string;
    // Per-tier overrides — null = inherit funder base.
    maxPositions?: number | null;
    minRevenue?: string | null;
    minCreditTier?: 'unknown' | 'under_550' | '550_599' | '600_649' | '650_plus' | null;
  }[];
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
  emails: [],
  phones: [],
  contacts: [{ name: '', phone: '', email: '', isPrimary: true }],
  tiers: [],
  restrictedStates: [],
  restrictedIndustries: [],
});

export default function FundersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [funders, setFunders] = useState<Funder[]>([]);
  const [tiers, setTiers] = useState<FunderTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Funder | null>(null);
  const [quickView, setQuickView] = useState<Funder | null>(null);
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  // Industries pulled from Settings → match_options (kind='industry'). UI
  // shows whatever the admin has set up there + falls back to the seed list
  // so brand-new tenants aren't starting from a blank dropdown.
  const [industries, setIndustries] = useState<string[]>(COMMON_INDUSTRIES);
  // States shown in the restricted-states picker. Sourced from Settings →
  // match options when the admin has defined states there (same list the
  // Shop & Submit form uses); falls back to all 50 US states.
  const [stateList, setStateList] = useState<{ code: string; name: string }[]>(US_STATES);

  async function load() {
    setLoading(true);
    const [fres, tres, mres, sres] = await Promise.all([
      fetch('/api/funders', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/funder-tiers', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch('/api/settings/match-options?kind=industry', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch('/api/settings/match-options?kind=state', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    setFunders(fres.data ?? fres ?? []);
    setTiers(tres.data ?? []);
    // Use the admin-configured list when present; fall back to seed when empty.
    const adminIndustries = (mres.data ?? []) as { label: string; value: string; isActive: boolean }[];
    const names = adminIndustries.filter((o) => o.isActive !== false).map((o) => o.label);
    setIndustries(names.length ? names : COMMON_INDUSTRIES);
    // Admin-defined states: match against the canonical US list by code OR
    // name so restrictions keep storing 2-letter codes either way.
    const adminStates = (sres.data ?? []) as { label: string; value: string; isActive: boolean }[];
    if (adminStates.length) {
      const resolved = adminStates
        .filter((o) => o.isActive !== false)
        .map((o) => US_STATES.find((s) =>
          s.code.toLowerCase() === o.value.toLowerCase() ||
          s.code.toLowerCase() === o.label.toLowerCase() ||
          s.name.toLowerCase() === o.value.toLowerCase() ||
          s.name.toLowerCase() === o.label.toLowerCase()))
        .filter((s): s is { code: string; name: string } => !!s);
      if (resolved.length) setStateList(resolved);
    }
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
      plainSubjectOnly: editing.plainSubjectOnly ?? false,
      // Submission emails (used for shopping)
      emails: (editing.emails ?? []).map((e) => e.trim()).filter(Boolean),
      contacts: editing.contacts.filter((c) => c.name.trim() || c.email?.trim()),
      // Send tierAssignments (with per-tier overrides) — backend prefers this
      // shape over the legacy tierIds array.
      tierAssignments: editing.tiers.map((t) => ({
        tierId: t.id,
        maxPositions: t.maxPositions ?? null,
        minRevenue: t.minRevenue != null && t.minRevenue !== '' ? Number(t.minRevenue) : null,
        minCreditTier: t.minCreditTier ?? null,
      })),
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
    if (!(await confirm({ title: 'Delete this funder?', description: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true }))) return;
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
            <Button
              variant="outline"
              onClick={() => exportCSV('funders', filtered, [
                { key: 'name', label: 'Name' },
                { key: 'tiers', label: 'Tiers', format: (v) => (v as { name: string }[] | undefined)?.map((t) => t.name).join('; ') ?? '' },
                { key: 'submissionMethod', label: 'Submission Method' },
                { key: 'emails', label: 'Submission Emails', format: (v) => (Array.isArray(v) ? (v as string[]).join('; ') : '') },
                { key: 'phones', label: 'Phones', format: (v) => (Array.isArray(v) ? (v as string[]).join('; ') : '') },
                { key: 'contacts', label: 'Contact', format: (v) => {
                  const c = (v as { name: string; email: string | null; phone: string | null }[] | undefined)?.[0];
                  return c ? `${c.name}${c.email ? ' · ' + c.email : ''}${c.phone ? ' · ' + c.phone : ''}` : '';
                } },
                { key: 'minRevenue', label: 'Min Revenue', format: (v) => (v ? Number(v) : '') },
                { key: 'minCreditTier', label: 'Min Credit Tier' },
                { key: 'maxPositions', label: 'Max Positions' },
                { key: 'supportsReverseConsolidation', label: 'Supports Reverse' },
                { key: 'restrictedStates', label: 'Restricted States', format: (v) => (Array.isArray(v) ? (v as string[]).join('; ') : '') },
                { key: 'restrictedIndustries', label: 'Restricted Industries', format: (v) => (Array.isArray(v) ? (v as string[]).join('; ') : '') },
                { key: 'notes', label: 'Notes' },
                { key: 'isActive', label: 'Active' },
              ])}
              className="gap-1.5"
              disabled={filtered.length === 0}
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
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
        <TableSkeleton />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="data-grid w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Name</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Tiers</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Min revenue</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Max pos.</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Min credit</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground w-12"></th>
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
                      // Row click = QUICK VIEW (contacts + key criteria).
                      // Full editing lives behind the explicit Edit button.
                      onClick={() => setQuickView(f)}
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
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setEditing(f)}
                          title="Edit this funder"
                          className="text-xs font-medium text-primary hover:underline px-1"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>
      )}

      {quickView && (
        <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setQuickView(null)}>
          <div className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  {quickView.name}
                  {quickView.isActive
                    ? <Badge variant="success" className="text-[10px]">active</Badge>
                    : <Badge variant="outline" className="text-[10px]">inactive</Badge>}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {quickView.submissionMethod === 'email' ? 'Submits by email' : 'Submits by portal'}
                  {quickView.supportsReverseConsolidation && ' • reverse consolidation'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { const f = quickView; setQuickView(null); setEditing(f); }}
                >
                  Edit
                </Button>
                <button onClick={() => setQuickView(null)} className="text-muted-foreground hover:text-foreground p-1">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4 text-sm">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Min revenue</div>
                  <div className="tabular-nums">{formatCurrency(Number(quickView.minRevenue))}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Max positions</div>
                  <div className="tabular-nums">{quickView.maxPositions}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Min credit</div>
                  <div>{CREDIT_TIER_OPTIONS.find((c) => c.value === quickView.minCreditTier)?.label ?? '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Tiers</div>
                  <div className="flex gap-1 flex-wrap">
                    {quickView.tiers.length ? quickView.tiers.map((t) => (
                      <Badge key={t.id} variant="outline" className="text-[10px]">{t.name}</Badge>
                    )) : <span className="text-muted-foreground/60">none</span>}
                  </div>
                </div>
              </div>

              {/* Contacts */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Contacts</div>
                {quickView.contacts.length === 0 ? (
                  <div className="text-muted-foreground/60 text-xs">No contacts on file</div>
                ) : (
                  <div className="space-y-2">
                    {quickView.contacts.map((c, i) => (
                      <div key={c.id ?? i} className="rounded-lg border border-border p-3 space-y-1.5">
                        {/* Name + primary badge — `flex-wrap` so a long name
                            doesn't push the badge off the card. `min-w-0`
                            on the name lets `break-words` actually wrap
                            instead of refusing to shrink. */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-medium text-sm min-w-0 break-words">
                            {c.name || 'Unnamed'}
                          </div>
                          {c.isPrimary && <Badge variant="outline" className="text-[10px] shrink-0">primary</Badge>}
                        </div>
                        {c.email && (
                          <a
                            href={`mailto:${c.email}`}
                            className="flex items-start gap-1.5 text-xs text-primary hover:underline"
                          >
                            <Mail className="h-3 w-3 mt-0.5 shrink-0" />
                            {/* break-all (not break-words) because email
                                addresses don't contain word breaks — without
                                break-all, a long email overflows the card. */}
                            <span className="break-all min-w-0">{c.email}</span>
                          </a>
                        )}
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Phone className="h-3 w-3 shrink-0" />
                            <span className="break-all min-w-0">{c.phone}</span>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Restrictions */}
              {(quickView.restrictedStates.length > 0 || quickView.restrictedIndustries.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  {quickView.restrictedStates.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Restricted states</div>
                      <div className="text-xs">{quickView.restrictedStates.join(', ')}</div>
                    </div>
                  )}
                  {quickView.restrictedIndustries.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Restricted industries</div>
                      <div className="text-xs">{quickView.restrictedIndustries.join(', ')}</div>
                    </div>
                  )}
                </div>
              )}

              {quickView.notes && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Notes</div>
                  <div className="text-xs whitespace-pre-wrap">{quickView.notes}</div>
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setQuickView(null)}>Close</Button>
              <Button onClick={() => { setEditing(quickView); setQuickView(null); }}>Edit full details</Button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <FunderDrawer
          funder={editing}
          tiers={tiers}
          industries={industries}
          stateList={stateList}
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
  funder, tiers, industries, stateList = US_STATES, onChange, onClose, onSave, onDelete,
}: {
  funder: Funder;
  tiers: FunderTier[];
  industries: string[];
  stateList?: { code: string; name: string }[];
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
                <MoneyInput
                  value={funder.minRevenue === '' || funder.minRevenue === null || funder.minRevenue === undefined ? '' : Number(funder.minRevenue)}
                  onValueChange={(v) => update('minRevenue', v === '' ? '0' : String(v))}
                  placeholder="25,000"
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
            <div className="flex flex-col gap-2 text-sm">
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
              {/* For funders whose intake CRMs garble Unicode (rendering
                  zero-width chars as "?" in the subject). Turn this on for
                  that specific funder only. Trade-off: emails to this funder
                  will all share a Gmail thread on the sender's side. */}
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={funder.plainSubjectOnly ?? false}
                  onChange={(e) => update('plainSubjectOnly', e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Plain ASCII subject only
                  <span className="block text-[11px] text-muted-foreground">
                    Turn on if this funder&apos;s CRM shows &quot;?&quot; characters after the deal name.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Submission emails</h3>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Where deals are sent when you shop this funder. Multiple addresses OK — every one gets the email.
            </p>
            <div className="space-y-2">
              {(funder.emails ?? []).map((em, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="submissions@funder.com"
                    value={em}
                    onChange={(e) => {
                      const next = [...(funder.emails ?? [])];
                      next[i] = e.target.value;
                      update('emails', next);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => update('emails', (funder.emails ?? []).filter((_, idx) => idx !== i))}
                    className="text-xs text-muted-foreground hover:text-destructive px-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => update('emails', [...(funder.emails ?? []), ''])}>
                + Add submission email
              </Button>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Tiers</h3>
            <p className="text-[11px] text-muted-foreground -mt-1">
              A funder can belong to multiple tiers. Each tier can have its own max positions / min revenue / min credit — overrides the funder defaults above. Leave blank to inherit.
            </p>
            {tiers.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tiers defined yet. Create them in Settings.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {tiers.map((t) => {
                    const selected = funder.tiers.some((ft) => ft.id === t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          const next = selected
                            ? funder.tiers.filter((ft) => ft.id !== t.id)
                            : [...funder.tiers, { id: t.id, name: t.name, maxPositions: null, minRevenue: null, minCreditTier: null }];
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
                {funder.tiers.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {funder.tiers.map((ft, ti) => (
                      <div key={ft.id} className="rounded border border-border p-2.5 bg-muted/20">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold">{ft.name}</span>
                          <span className="text-[10px] text-muted-foreground">overrides (blank = inherit)</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Max positions</label>
                            <Input
                              type="number"
                              min={0}
                              placeholder={String(funder.maxPositions)}
                              value={ft.maxPositions == null ? '' : String(ft.maxPositions)}
                              onChange={(e) => {
                                const next = [...funder.tiers];
                                next[ti] = { ...ft, maxPositions: e.target.value === '' ? null : parseInt(e.target.value, 10) };
                                update('tiers', next);
                              }}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Min revenue</label>
                            <Input
                              type="number"
                              min={0}
                              placeholder={funder.minRevenue}
                              value={ft.minRevenue == null ? '' : String(ft.minRevenue)}
                              onChange={(e) => {
                                const next = [...funder.tiers];
                                next[ti] = { ...ft, minRevenue: e.target.value === '' ? null : e.target.value };
                                update('tiers', next);
                              }}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Min credit</label>
                            <select
                              value={ft.minCreditTier ?? ''}
                              onChange={(e) => {
                                const next = [...funder.tiers];
                                next[ti] = { ...ft, minCreditTier: e.target.value === '' ? null : e.target.value as Funder['minCreditTier'] };
                                update('tiers', next);
                              }}
                              className="h-9 w-full rounded-md border border-input bg-card px-2 text-xs"
                            >
                              <option value="">inherit</option>
                              <option value="unknown">Unknown</option>
                              <option value="under_550">Under 550</option>
                              <option value="550_599">550–599</option>
                              <option value="600_649">600–649</option>
                              <option value="650_plus">650+</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Contacts</h3>
              <Button variant="outline" size="sm" onClick={addContact}>+ Add</Button>
            </div>
            {funder.contacts.map((c, i) => (
              <div key={i} className="rounded border border-border p-3 space-y-2">
                {/* Stack contact fields vertically — when packed in a 2-col
                    grid, long emails were visually colliding with the name
                    field on narrower modal widths. The vertical layout
                    guarantees breathing room and matches the labeled-field
                    convention used elsewhere in the app. */}
                <Field label="Name">
                  <Input placeholder="Contact name" value={c.name} onChange={(e) => updateContact(i, 'name', e.target.value)} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Email">
                    <Input type="email" placeholder="contact@funder.com" value={c.email ?? ''} onChange={(e) => updateContact(i, 'email', e.target.value)} />
                  </Field>
                  <Field label="Phone">
                    <Input placeholder="(555) 555-5555" value={c.phone ?? ''} onChange={(e) => updateContact(i, 'phone', e.target.value)} />
                  </Field>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-border/40">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={c.isPrimary}
                      onChange={(e) => updateContact(i, 'isPrimary', e.target.checked)}
                    />
                    Primary contact
                  </label>
                  <button
                    onClick={() => removeContact(i)}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Remove contact
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Restricted states</h3>
            <p className="text-xs text-muted-foreground">Click to toggle. Funder will not match deals from selected states.</p>
            <div className="flex flex-wrap gap-1">
              {stateList.map((s) => {
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
            <p className="text-[11px] text-muted-foreground -mt-1">Manage the master list in Settings → Match options.</p>
            <div className="flex flex-wrap gap-1">
              {/* Merge admin list + anything already on this funder so saved data is never lost. */}
              {Array.from(new Set([...industries, ...funder.restrictedIndustries])).map((ind) => {
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
  const toast = useToast();
  type Mode = 'manual' | 'csv';
  const [mode, setMode] = useState<Mode>('manual');

  // ---- Manual entry rows ----
  interface Row {
    name: string;
    tiers: string;
    submissionEmail: string;
    contactName: string;
    contactPhone: string;
    minRevenue: string;
    notes: string;
  }
  const blankRow = (): Row => ({
    name: '', tiers: '', submissionEmail: '', contactName: '',
    contactPhone: '', minRevenue: '', notes: '',
  });
  const [rows, setRows] = useState<Row[]>([blankRow(), blankRow(), blankRow()]);
  const [savingManual, setSavingManual] = useState(false);

  function updateRow(i: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, blankRow()]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function saveManual() {
    const filled = rows.filter((r) => r.name.trim());
    if (!filled.length) {
      toast.error('Add at least one funder name.');
      return;
    }
    // Build a CSV in-memory from the simple rows and reuse the import endpoint
    const headers = ['name', 'tiers', 'submission_email', 'contact_name', 'contact_phone', 'min_revenue', 'notes'];
    const esc = (s: string) => (s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = [
      headers.join(','),
      ...filled.map((r) => [
        r.name, r.tiers, r.submissionEmail, r.contactName,
        r.contactPhone, r.minRevenue.replace(/[^\d.]/g, ''), r.notes,
      ].map(esc).join(',')),
    ].join('\n');

    setSavingManual(true);
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'manual.csv');
    const res = await fetch('/api/funders/bulk', { method: 'POST', body: fd });
    const json = await res.json();
    setSavingManual(false);
    if (!res.ok) {
      toast.error(json.error || 'Save failed.');
      return;
    }
    onComplete(json.ok ?? filled.length, json.failed ?? 0);
  }

  // ---- CSV upload ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{
    ok: number; failed: number; total: number;
    errors: { row: number; message: string }[]; created: string[]; updated?: string[];
  } | null>(null);

  function onFileChosen(f: File | null) {
    if (!f) return;
    const lower = f.name.toLowerCase();
    const ok = lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls');
    if (!ok) {
      toast.error('File must be .csv, .xlsx, or .xls');
      return;
    }
    setFile(f);
    setResult(null);
  }

  async function uploadCsv() {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/funders/bulk', { method: 'POST', body: fd });
    const json = await res.json();
    setUploading(false);
    if (!res.ok) {
      setResult({ ok: 0, failed: 0, total: 0, errors: [{ row: 0, message: json.error || 'Upload failed' }], created: [], updated: [] });
      return;
    }
    setResult(json);
    if ((json.failed ?? 0) === 0) {
      setTimeout(() => onComplete(json.ok, json.failed), 1200);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-4xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Add funders</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Type them in directly, or upload a CSV or Excel file.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1.5 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="px-6 pt-4">
          <div className="inline-flex bg-muted rounded-lg p-1">
            {([['manual', 'Type them in'], ['csv', 'Upload file']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-4 py-1.5 rounded text-sm font-medium transition',
                  mode === m ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {mode === 'manual' ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Only <strong>Name</strong> is required. Separate multiple tiers with a semicolon (e.g. <span className="font-mono">A-Paper;Subprime</span>). Leave anything you don&apos;t know blank.
              </p>

              {/* Clean table: header line on top, simple inputs below */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm min-w-[820px]">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-left">
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Name *</th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tier(s)</th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Submission email</th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Contact name</th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Contact phone</th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Min revenue</th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Notes</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {rows.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="p-1.5"><input className="w-full h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={r.name} onChange={(e) => updateRow(i, 'name', e.target.value)} placeholder="Velocity Capital" /></td>
                        <td className="p-1.5"><input className="w-full h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={r.tiers} onChange={(e) => updateRow(i, 'tiers', e.target.value)} placeholder="A-Paper" /></td>
                        <td className="p-1.5"><input className="w-full h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={r.submissionEmail} onChange={(e) => updateRow(i, 'submissionEmail', e.target.value)} placeholder="subs@funder.com" /></td>
                        <td className="p-1.5"><input className="w-full h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={r.contactName} onChange={(e) => updateRow(i, 'contactName', e.target.value)} placeholder="Sarah Lee" /></td>
                        <td className="p-1.5"><input className="w-full h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={r.contactPhone} onChange={(e) => updateRow(i, 'contactPhone', e.target.value)} placeholder="555-123-4567" /></td>
                        <td className="p-1.5"><input className="w-full h-9 rounded-md border border-input bg-card px-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" value={r.minRevenue} onChange={(e) => updateRow(i, 'minRevenue', e.target.value)} placeholder="25000" /></td>
                        <td className="p-1.5"><input className="w-full h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={r.notes} onChange={(e) => updateRow(i, 'notes', e.target.value)} placeholder="optional" /></td>
                        <td className="p-1.5 text-center">
                          <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive p-1 rounded" title="Remove row" disabled={rows.length === 1}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button onClick={addRow} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <Plus className="h-3.5 w-3.5" /> Add another row
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Step 1 download */}
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium mb-1">1. Download the template</div>
                <p className="text-xs text-muted-foreground mb-2">
                  Simple = 4 columns (name, submission email, tiers, notes) — all most uploads need.
                  Only <span className="font-medium">name</span> is required; column names are flexible
                  (&quot;Funder&quot;, &quot;Email&quot;, &quot;Phone&quot; etc. all work).
                </p>
                <div className="flex flex-wrap gap-2">
                  <a href="/api/funders/bulk" download="funders_template.csv" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border bg-card hover:bg-muted transition-colors">
                    <Download className="h-3.5 w-3.5" /> Simple template (CSV)
                  </a>
                  <a href="/api/funders/bulk?full=1" download="funders_template_full.csv" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border bg-card hover:bg-muted transition-colors text-muted-foreground">
                    <Download className="h-3.5 w-3.5" /> Full template (all columns)
                  </a>
                </div>
              </div>
              {/* Step 2 upload */}
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="text-sm font-medium mb-2">2. Upload your filled file</div>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); onFileChosen(e.dataTransfer.files?.[0] ?? null); }}
                  className={cn('border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors', dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30 hover:bg-card')}
                >
                  {file ? (
                    <div className="flex items-center justify-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="font-medium">{file.name}</span>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      <Upload className="h-5 w-5 mx-auto mb-1.5 text-muted-foreground/70" />
                      Click to pick a file, or drag &amp; drop here
                      <div className="text-[11px] text-muted-foreground/70 mt-1">.csv, .xlsx, or .xls</div>
                    </div>
                  )}
                </div>
              </div>

              {result && (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                      <div className="text-2xl font-semibold text-emerald-700 tabular-nums">{result.created?.length ?? 0}</div>
                      <div className="text-[10px] uppercase tracking-wider text-emerald-700/80 mt-0.5">New</div>
                    </div>
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-center">
                      <div className="text-2xl font-semibold text-sky-700 tabular-nums">{result.updated?.length ?? 0}</div>
                      <div className="text-[10px] uppercase tracking-wider text-sky-700/80 mt-0.5">Updated</div>
                    </div>
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-center">
                      <div className="text-2xl font-semibold text-rose-700 tabular-nums">{result.failed}</div>
                      <div className="text-[10px] uppercase tracking-wider text-rose-700/80 mt-0.5">Failed</div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
                      <div className="text-2xl font-semibold text-foreground tabular-nums">{result.total}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Total</div>
                    </div>
                  </div>
                  {result.errors.length > 0 && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 max-h-40 overflow-y-auto text-xs text-rose-700 space-y-0.5">
                      {result.errors.map((e, i) => (
                        <div key={i} className="flex gap-2"><span className="font-mono shrink-0">Row {e.row}:</span><span>{e.message}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {mode === 'manual' ? (
            <Button onClick={saveManual} loading={savingManual}>
              Save funders
            </Button>
          ) : (
            !result && <Button onClick={uploadCsv} disabled={!file} loading={uploading}>Import CSV</Button>
          )}
          {mode === 'csv' && result && result.failed > 0 && (
            <Button onClick={() => onComplete(result.ok, result.failed)}>Done</Button>
          )}
        </div>
      </div>
    </div>
  );
}
