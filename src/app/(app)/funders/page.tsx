'use client';

import { useEffect, useState } from 'react';
import {
  Card, CardContent,
  Button, Input, Textarea, Field, Badge,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { US_STATES, COMMON_INDUSTRIES, CREDIT_TIER_OPTIONS } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';

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
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Funders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your funder directory. Used by the deal-shopping engine to match merchants.
          </p>
        </div>
        <Button onClick={() => setEditing(blankFunder())}>+ Add funder</Button>
      </header>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search funders..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setTierFilter('all')}
            className={`px-3 py-1 rounded text-xs ${tierFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
          >
            All ({funders.length})
          </button>
          {tiers.map((t) => (
            <button
              key={t.id}
              onClick={() => setTierFilter(t.id)}
              className={`px-3 py-1 rounded text-xs ${tierFilter === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            >
              {t.name}
            </button>
          ))}
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
