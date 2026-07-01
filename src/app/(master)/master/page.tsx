'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, Button, Input, Field, Badge } from '@/components/ui/primitives';
import { Plus, Building2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface Company {
  id: string; name: string; slug: string; emailMode: string;
  isActive: boolean; createdAt: string; userCount: number; funderCount: number;
}

export default function MasterCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', adminEmail: '', adminName: '', adminPassword: '' });
  // Funder directory seeding for the new company:
  //   'copy'   — hand them an existing company's list as their base
  //   'none'   — start empty, they upload their own
  //   'master' — platform default funders (legacy)
  const [funderSeedMode, setFunderSeedMode] = useState<'master' | 'copy' | 'none'>('none');
  const [copyFromCompanyId, setCopyFromCompanyId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/companies');
    const data = await res.json();
    setCompanies(Array.isArray(data) ? data : (data.companies ?? []));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function create() {
    setError(null);
    if (!form.name || !form.adminEmail || !form.adminName || !form.adminPassword) {
      setError('All fields required'); return;
    }
    if (form.adminPassword.length < 10) {
      setError('Password must be at least 10 characters'); return;
    }
    if (funderSeedMode === 'copy' && !copyFromCompanyId) {
      setError('Pick which company to copy the funder list from.'); return;
    }
    const slug = form.slug || autoSlug(form.name);
    setCreating(true);
    const res = await fetch('/api/companies', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form, slug, funderSeedMode,
        copyFromCompanyId: funderSeedMode === 'copy' ? copyFromCompanyId : null,
      }),
    });
    setCreating(false);
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed'); return; }
    setShowForm(false);
    setForm({ name: '', slug: '', adminEmail: '', adminName: '', adminPassword: '' });
    setFunderSeedMode('none');
    setCopyFromCompanyId('');
    load();
  }

  async function toggleActive(c: Company) {
    await fetch(`/api/companies/${c.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !c.isActive }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage tenants. Deal data is never visible from this account.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5" /> New company
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="text-base font-medium">Create new company</div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Company name">
                <Input value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || autoSlug(e.target.value) })} />
              </Field>
              <Field label="Slug" hint="lowercase, hyphens. Used in URLs.">
                <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
              </Field>
              <Field label="Admin name">
                <Input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
              </Field>
              <Field label="Admin email">
                <Input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
              </Field>
              <Field label="Admin password" hint="Min 10 chars. Share this securely with the admin." className="md:col-span-2">
                <Input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
              </Field>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Funder list</div>
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="funderSeed" checked={funderSeedMode === 'none'} onChange={() => setFunderSeedMode('none')} />
                  <span>Start empty — they upload or enter their own funders</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="funderSeed" checked={funderSeedMode === 'copy'} onChange={() => setFunderSeedMode('copy')} />
                  <span>Copy an existing company&apos;s funder list as their base</span>
                </label>
                {funderSeedMode === 'copy' && (
                  <select
                    value={copyFromCompanyId}
                    onChange={(e) => setCopyFromCompanyId(e.target.value)}
                    className="ml-6 h-9 rounded-md border border-input bg-card px-2 text-sm"
                  >
                    <option value="">— pick company —</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.funderCount} funders)</option>)}
                  </select>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="funderSeed" checked={funderSeedMode === 'master'} onChange={() => setFunderSeedMode('master')} />
                  <span>Platform default funders</span>
                </label>
              </div>
              <div className="text-xs text-muted-foreground">
                Copies are independent — their edits never touch the source list. Commission rules are always seeded.
              </div>
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
            <div className="flex gap-2">
              <Button onClick={create} disabled={creating}>{creating ? 'Creating…' : 'Create company'}</Button>
              <Button variant="ghost" onClick={() => { setShowForm(false); setError(null); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : companies.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Building2 className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <div className="text-sm font-medium">No companies yet</div>
            <div className="text-xs text-muted-foreground mt-1">Click "New company" to onboard your first tenant.</div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left p-3 font-medium">Company</th>
                  <th className="text-left p-3 font-medium">Slug</th>
                  <th className="text-left p-3 font-medium">Email mode</th>
                  <th className="text-left p-3 font-medium">Users</th>
                  <th className="text-left p-3 font-medium">Funders</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Created</th>
                  <th className="w-32"></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3 text-muted-foreground tabular-nums">{c.slug}</td>
                    <td className="p-3">{c.emailMode === 'shared' ? 'Shared' : 'Per-rep'}</td>
                    <td className="p-3 tabular-nums">{c.userCount}</td>
                    <td className="p-3 tabular-nums">{c.funderCount}</td>
                    <td className="p-3">{c.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="default">Suspended</Badge>}</td>
                    <td className="p-3 text-muted-foreground">{formatDate(c.createdAt)}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => toggleActive(c)} className="text-xs text-muted-foreground hover:text-foreground">
                        {c.isActive ? 'Suspend' : 'Activate'}
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
