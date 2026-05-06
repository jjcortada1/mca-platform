'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, Button, Input, Field, Badge, Select, Textarea, MoneyInput } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { Plus, Trash2, X, Edit3 } from 'lucide-react';
import { US_STATES, COMMON_INDUSTRIES, CREDIT_TIER_OPTIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface MasterFunder {
  id: string;
  name: string;
  submissionMethod: 'email' | 'portal';
  supportsReverseConsolidation: boolean;
  minRevenue: number;
  maxPositions: number;
  minCreditTier: string;
  notes: string | null;
  payload: {
    tiers?: string[];
    contacts?: { name: string; phone?: string; email?: string; isPrimary?: boolean }[];
    restrictedStates?: string[];
    restrictedIndustries?: string[];
  };
}

const EMPTY_FORM = {
  name: '',
  submissionMethod: 'email' as 'email' | 'portal',
  supportsReverseConsolidation: false,
  minRevenue: 0,
  maxPositions: 99,
  minCreditTier: 'unknown',
  notes: '',
  tiers: [] as string[],
  contacts: [] as { name: string; phone?: string; email?: string; isPrimary?: boolean }[],
  restrictedStates: [] as string[],
  restrictedIndustries: [] as string[],
};

export default function MasterFundersPage() {
  const toast = useToast();
  const [funders, setFunders] = useState<MasterFunder[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MasterFunder | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const d = await fetch('/api/master-funders').then((r) => r.json());
    setFunders(Array.isArray(d) ? d : (d.funders ?? []));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCreating(true);
  }
  function openEdit(f: MasterFunder) {
    setEditing(f);
    setCreating(false);
    setForm({
      name: f.name,
      submissionMethod: f.submissionMethod,
      supportsReverseConsolidation: f.supportsReverseConsolidation,
      minRevenue: f.minRevenue,
      maxPositions: f.maxPositions,
      minCreditTier: f.minCreditTier,
      notes: f.notes ?? '',
      tiers: f.payload?.tiers ?? [],
      contacts: f.payload?.contacts ?? [],
      restrictedStates: f.payload?.restrictedStates ?? [],
      restrictedIndustries: f.payload?.restrictedIndustries ?? [],
    });
  }
  function close() { setEditing(null); setCreating(false); }

  async function save() {
    const url = editing ? `/api/master-funders/${editing.id}` : '/api/master-funders';
    const method = editing ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const d = await res.json();
      toast.error(d.error || 'Save failed.');
      return;
    }
    toast.success(editing ? 'Master funder updated.' : 'Master funder created.');
    close();
    load();
  }

  async function del(id: string) {
    if (!confirm('Delete this default funder? Existing companies are unaffected.')) return;
    const res = await fetch(`/api/master-funders/${id}`, { method: 'DELETE' });
    if (res.ok) toast.success('Deleted.');
    else toast.error('Delete failed.');
    load();
  }

  function addTier() {
    const t = prompt('Tier name (e.g. "Tier 1 (A Paper)")')?.trim();
    if (t && !form.tiers.includes(t)) setForm({ ...form, tiers: [...form.tiers, t] });
  }
  function addContact() {
    setForm({ ...form, contacts: [...form.contacts, { name: '', email: '', isPrimary: form.contacts.length === 0 }] });
  }
  function updateContact(i: number, patch: Partial<{ name: string; phone: string; email: string; isPrimary: boolean }>) {
    setForm({ ...form, contacts: form.contacts.map((c, idx) => idx === i ? { ...c, ...patch } : c) });
  }
  function removeContact(i: number) {
    setForm({ ...form, contacts: form.contacts.filter((_, idx) => idx !== i) });
  }

  function toggleState(code: string) {
    setForm({
      ...form,
      restrictedStates: form.restrictedStates.includes(code)
        ? form.restrictedStates.filter((s) => s !== code)
        : [...form.restrictedStates, code],
    });
  }
  function toggleIndustry(name: string) {
    setForm({
      ...form,
      restrictedIndustries: form.restrictedIndustries.includes(name)
        ? form.restrictedIndustries.filter((s) => s !== name)
        : [...form.restrictedIndustries, name],
    });
  }

  const isEditing = creating || editing !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Default funders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cloned into each new company on creation. Edits don't affect existing companies.
          </p>
        </div>
        {!isEditing && (
          <Button onClick={openCreate}><Plus className="h-3.5 w-3.5" /> New default funder</Button>
        )}
      </div>

      {isEditing ? (
        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-base font-medium">{editing ? 'Edit' : 'New'} default funder</div>
              <Button variant="ghost" size="sm" onClick={close}><X className="h-3.5 w-3.5" /></Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name" className="md:col-span-2">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Submission method">
                <Select value={form.submissionMethod} onChange={(e) => setForm({ ...form, submissionMethod: e.target.value as any })}>
                  <option value="email">Email</option>
                  <option value="portal">Portal</option>
                </Select>
              </Field>
              <Field label="Reverse consolidation">
                <Select value={form.supportsReverseConsolidation ? 'yes' : 'no'}
                  onChange={(e) => setForm({ ...form, supportsReverseConsolidation: e.target.value === 'yes' })}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </Select>
              </Field>
              <Field label="Min revenue ($)">
                <MoneyInput
                  value={form.minRevenue || 0}
                  onValueChange={(v) => setForm({ ...form, minRevenue: v === '' ? 0 : v })}
                  placeholder="25,000"
                />
              </Field>
              <Field label="Max positions">
                <Input type="number" value={form.maxPositions} onChange={(e) => setForm({ ...form, maxPositions: parseInt(e.target.value || '0', 10) })} />
              </Field>
              <Field label="Min credit tier">
                <Select value={form.minCreditTier} onChange={(e) => setForm({ ...form, minCreditTier: e.target.value })}>
                  {CREDIT_TIER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              <Field label="Notes" className="md:col-span-2">
                <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>

            {/* Tiers */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Tiers</div>
                <Button type="button" variant="outline" size="sm" onClick={addTier}><Plus className="h-3 w-3" /> Add tier</Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {form.tiers.map((t) => (
                  <Badge key={t} variant="outline" className="gap-1">
                    {t}
                    <button onClick={() => setForm({ ...form, tiers: form.tiers.filter((x) => x !== t) })}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
                {form.tiers.length === 0 && <span className="text-xs text-muted-foreground">No tiers</span>}
              </div>
            </div>

            {/* Contacts */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Contacts</div>
                <Button type="button" variant="outline" size="sm" onClick={addContact}><Plus className="h-3 w-3" /> Add contact</Button>
              </div>
              <div className="space-y-2">
                {form.contacts.map((c, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input placeholder="Name" value={c.name} onChange={(e) => updateContact(i, { name: e.target.value })} className="flex-1" />
                    <Input placeholder="Email" value={c.email ?? ''} onChange={(e) => updateContact(i, { email: e.target.value })} className="flex-1" />
                    <Input placeholder="Phone" value={c.phone ?? ''} onChange={(e) => updateContact(i, { phone: e.target.value })} className="w-32" />
                    <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                      <input type="checkbox" checked={!!c.isPrimary} onChange={(e) => updateContact(i, { isPrimary: e.target.checked })} />
                      Primary
                    </label>
                    <button onClick={() => removeContact(i)} className="text-muted-foreground hover:text-destructive p-1.5">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {form.contacts.length === 0 && <div className="text-xs text-muted-foreground">No contacts</div>}
              </div>
            </div>

            {/* Restricted states */}
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Restricted states</div>
              <div className="flex flex-wrap gap-1">
                {US_STATES.map((s) => (
                  <button
                    key={s.code} onClick={() => toggleState(s.code)} type="button"
                    className={cn('text-xs px-2 py-1 rounded border transition-colors',
                      form.restrictedStates.includes(s.code)
                        ? 'bg-destructive/10 border-destructive/30 text-destructive'
                        : 'border-border hover:bg-muted')}
                  >
                    {s.code}
                  </button>
                ))}
              </div>
            </div>

            {/* Restricted industries */}
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Restricted industries</div>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_INDUSTRIES.map((ind) => (
                  <button
                    key={ind} onClick={() => toggleIndustry(ind)} type="button"
                    className={cn('text-xs px-2 py-1 rounded border transition-colors',
                      form.restrictedIndustries.includes(ind)
                        ? 'bg-destructive/10 border-destructive/30 text-destructive'
                        : 'border-border hover:bg-muted')}
                  >
                    {ind}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t border-border">
              <Button onClick={save}>{editing ? 'Save changes' : 'Create default funder'}</Button>
              <Button variant="ghost" onClick={close}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : funders.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-sm font-medium">No default funders</div>
            <div className="text-xs text-muted-foreground mt-1">
              The seed script populates this list. Click "New default funder" to add manually.
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Method</th>
                  <th className="text-left p-3 font-medium">Min revenue</th>
                  <th className="text-left p-3 font-medium">Max positions</th>
                  <th className="text-left p-3 font-medium">Reverse</th>
                  <th className="w-32"></th>
                </tr>
              </thead>
              <tbody>
                {funders.map((f) => (
                  <tr key={f.id} className="border-t border-border hover:bg-muted/40">
                    <td className="p-3 font-medium">{f.name}</td>
                    <td className="p-3">{f.submissionMethod === 'email' ? 'Email' : 'Portal'}</td>
                    <td className="p-3 tabular-nums">${f.minRevenue.toLocaleString()}</td>
                    <td className="p-3 tabular-nums">{f.maxPositions}</td>
                    <td className="p-3">{f.supportsReverseConsolidation ? <Badge variant="success">Yes</Badge> : '—'}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => openEdit(f)} className="text-xs text-primary hover:underline mr-3">
                        <Edit3 className="h-3 w-3 inline mr-0.5" /> Edit
                      </button>
                      <button onClick={() => del(f.id)} className="text-xs text-destructive hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
