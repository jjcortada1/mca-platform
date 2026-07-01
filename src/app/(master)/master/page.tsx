'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, Button, Input, Field, Badge } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirm } from '@/components/confirm-provider';
import { Plus, Building2, SlidersHorizontal, Users as UsersIcon, Trash2, KeyRound } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { ALL_NAV_ITEMS } from '@/components/sidebar';

// Permission checklist offered when adding/editing a rep from the master
// surface. Mirrors the in-app settings list; company_admin implies all.
const PERMISSION_CHOICES: { key: string; label: string }[] = [
  { key: 'deals.view', label: 'View deals' },
  { key: 'deals.shop', label: 'Shop deals' },
  { key: 'deals.submit', label: 'Submit deals' },
  { key: 'submissions.view', label: 'View submissions' },
  { key: 'submissions.edit', label: 'Edit submissions' },
  { key: 'active_deals.view', label: 'View active deals' },
  { key: 'active_deals.edit', label: 'Edit active deals' },
  { key: 'funded_board.view', label: 'View funded board' },
  { key: 'funders.view', label: 'View funders' },
  { key: 'funders.edit', label: 'Edit funders' },
  { key: 'calculator.use', label: 'Use calculator' },
  { key: 'info.view', label: 'View info' },
  { key: 'commissions.view', label: 'View own commissions' },
];
const DEFAULT_REP_PERMS = PERMISSION_CHOICES
  .filter((p) => !['funders.edit'].includes(p.key))
  .map((p) => p.key);

interface Company {
  id: string; name: string; slug: string; emailMode: string;
  isActive: boolean; createdAt: string; userCount: number; funderCount: number;
  isPlatformOwner?: boolean;
  enabledNavItems?: string[] | null;
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

  // ---- Per-company feature access editor ----
  // Which company's access panel is open, and its working checkbox state.
  const [accessOpenId, setAccessOpenId] = useState<string | null>(null);
  const [accessItems, setAccessItems] = useState<Set<string>>(new Set());
  const [accessSaving, setAccessSaving] = useState(false);

  function openAccess(c: Company) {
    if (accessOpenId === c.id) { setAccessOpenId(null); return; }
    // null = everything enabled → start with all boxes checked.
    const current = c.enabledNavItems ?? ALL_NAV_ITEMS.map((i) => i.href);
    setAccessItems(new Set(current));
    setAccessOpenId(c.id);
  }

  async function saveAccess(c: Company) {
    setAccessSaving(true);
    // Everything checked → store null ("all features") so future app
    // releases with new tabs show up without re-editing each company.
    const allChecked = ALL_NAV_ITEMS.every((i) => accessItems.has(i.href));
    const res = await fetch(`/api/companies/${c.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabledNavItems: allChecked ? null : Array.from(accessItems) }),
    });
    setAccessSaving(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not save access'); return; }
    setAccessOpenId(null);
    load();
  }

  // ---- Users panel + delete ----
  const [usersOpenId, setUsersOpenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Company | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  async function deleteCompany(c: Company) {
    const res = await fetch(`/api/companies/${c.id}?confirm=${encodeURIComponent(c.name)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Could not delete company');
      return;
    }
    setPendingDelete(null);
    setDeleteConfirmText('');
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
                  <>
                    <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                      <td className="p-3 font-medium">
                        {c.name}
                        {c.isPlatformOwner && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-200 font-medium">Owner</span>}
                      </td>
                      <td className="p-3 text-muted-foreground tabular-nums">{c.slug}</td>
                      <td className="p-3">{c.emailMode === 'shared' ? 'Shared' : 'Per-rep'}</td>
                      <td className="p-3 tabular-nums">{c.userCount}</td>
                      <td className="p-3 tabular-nums">{c.funderCount}</td>
                      <td className="p-3">{c.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="default">Suspended</Badge>}</td>
                      <td className="p-3 text-muted-foreground">{formatDate(c.createdAt)}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => setUsersOpenId(usersOpenId === c.id ? null : c.id)}
                          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mr-3"
                          title="Manage this company's users"
                        >
                          <UsersIcon className="h-3 w-3" /> Users
                        </button>
                        {!c.isPlatformOwner && (
                          <button
                            onClick={() => openAccess(c)}
                            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mr-3"
                            title="Choose which features this company can use"
                          >
                            <SlidersHorizontal className="h-3 w-3" /> Access
                          </button>
                        )}
                        <button onClick={() => toggleActive(c)} className="text-xs text-muted-foreground hover:text-foreground mr-3">
                          {c.isActive ? 'Suspend' : 'Activate'}
                        </button>
                        {!c.isPlatformOwner && (
                          <button
                            onClick={() => { setPendingDelete(c); setDeleteConfirmText(''); }}
                            className="text-xs text-rose-600 hover:text-rose-700 inline-flex items-center gap-1"
                            title="Permanently delete this company and all its data"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        )}
                      </td>
                    </tr>
                    {accessOpenId === c.id && (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={8} className="p-4">
                          <div className="space-y-3 max-w-2xl">
                            <div className="text-sm font-medium">Feature access for {c.name}</div>
                            <p className="text-xs text-muted-foreground">
                              Unchecked features disappear from this company&apos;s sidebar for every one of their
                              users. Their admin still controls per-user permissions within what you allow here.
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                              {ALL_NAV_ITEMS.map((item) => (
                                <label key={item.href} className="flex items-center gap-2 text-sm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={accessItems.has(item.href)}
                                    onChange={(e) => {
                                      setAccessItems((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(item.href); else next.delete(item.href);
                                        return next;
                                      });
                                    }}
                                    className="h-3.5 w-3.5 rounded"
                                  />
                                  <span>{item.label}</span>
                                </label>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => saveAccess(c)} disabled={accessSaving}>
                                {accessSaving ? 'Saving…' : 'Save access'}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setAccessOpenId(null)}>Cancel</Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    {usersOpenId === c.id && (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={8} className="p-4">
                          <CompanyUsersPanel companyId={c.id} companyName={c.name} onChanged={load} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          destructive
          title={`Delete "${pendingDelete.name}"?`}
          description={`This permanently removes the company and ALL of its data — users, funders, deals, submissions, commissions. This cannot be undone. Type the company name to confirm.`}
          confirmLabel="Delete company"
          confirmDisabled={deleteConfirmText !== pendingDelete.name}
          onCancel={() => { setPendingDelete(null); setDeleteConfirmText(''); }}
          onConfirm={() => deleteCompany(pendingDelete)}
        >
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={pendingDelete.name}
            autoFocus
          />
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ============================================================
   Per-company user management (master surface). Add reps/admins,
   set role + permissions, reset passwords, change who's admin.
   ============================================================ */

interface CompanyUserRow {
  id: string; email: string; name: string; role: string;
  isActive: boolean; permissions: string[];
}

function CompanyUsersPanel({ companyId, companyName, onChanged }: { companyId: string; companyName: string; onChanged: () => void }) {
  const confirmDialog = useConfirm();
  const [users, setUsers] = useState<CompanyUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<CompanyUserRow | null>(null);

  const [form, setForm] = useState<{ name: string; email: string; role: string; password: string; permissions: Set<string> }>(
    { name: '', email: '', role: 'rep', password: '', permissions: new Set(DEFAULT_REP_PERMS) }
  );

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/companies/${companyId}/users`, { cache: 'no-store' }).then((x) => x.json()).catch(() => ({}));
    setUsers(r.data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId]);

  async function addUser() {
    setErr(null);
    if (!form.name || !form.email || form.password.length < 8) {
      setErr('Name, email, and a password (8+ chars) are required.');
      return;
    }
    const res = await fetch(`/api/companies/${companyId}/users`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.name, email: form.email, role: form.role, password: form.password,
        permissions: form.role === 'rep' ? Array.from(form.permissions) : [],
      }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not add user'); return; }
    setAdding(false);
    setForm({ name: '', email: '', role: 'rep', password: '', permissions: new Set(DEFAULT_REP_PERMS) });
    load(); onChanged();
  }

  async function patchUser(u: CompanyUserRow, body: Record<string, unknown>) {
    setErr(null);
    const res = await fetch(`/api/companies/${companyId}/users/${u.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not update user'); return; }
    load(); onChanged();
  }

  async function deleteUser(u: CompanyUserRow) {
    if (!(await confirmDialog({ title: `Remove ${u.name} from ${companyName}?`, description: 'This deletes their login.', confirmLabel: 'Remove', destructive: true }))) return;
    const res = await fetch(`/api/companies/${companyId}/users/${u.id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not delete'); return; }
    load(); onChanged();
  }

  const roleLabel = (r: string) => r === 'company_admin' ? 'Admin' : r === 'lead_source' ? 'Lead source' : 'Rep';

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Users — {companyName}</div>
        {!adding && <Button size="sm" onClick={() => setAdding(true)} className="gap-1"><Plus className="h-3.5 w-3.5" /> Add user</Button>}
      </div>
      {err && <div className="text-xs text-destructive">{err}</div>}

      {adding && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input type="email" placeholder="Email (must be unique)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
              <option value="rep">Rep</option>
              <option value="company_admin">Admin (full access)</option>
              <option value="lead_source">Lead source (payout portal only)</option>
            </select>
            <Input type="text" placeholder="Temp password (they can change it)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          {form.role === 'rep' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
              {PERMISSION_CHOICES.map((p) => (
                <label key={p.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={form.permissions.has(p.key)}
                    onChange={(e) => setForm((f) => { const n = new Set(f.permissions); if (e.target.checked) n.add(p.key); else n.delete(p.key); return { ...f, permissions: n }; })}
                    className="h-3.5 w-3.5 rounded" />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={addUser}>Create user</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setErr(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : users.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No users yet.</div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border/60">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{u.name} {!u.isActive && <span className="text-[10px] text-muted-foreground">(suspended)</span>}</div>
                <div className="text-[11px] text-muted-foreground font-mono truncate">{u.email}</div>
              </div>
              <select
                value={u.role}
                onChange={(e) => patchUser(u, { role: e.target.value })}
                className="h-8 rounded-md border border-input bg-card px-1.5 text-xs"
                title="Change role (set to Admin to make this the company admin)"
              >
                <option value="rep">Rep</option>
                <option value="company_admin">Admin</option>
                <option value="lead_source">Lead source</option>
              </select>
              <button onClick={() => setResetFor(u)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" title="Reset password">
                <KeyRound className="h-3 w-3" /> Reset
              </button>
              <button onClick={() => patchUser(u, { isActive: !u.isActive })} className="text-xs text-muted-foreground hover:text-foreground">
                {u.isActive ? 'Suspend' : 'Activate'}
              </button>
              <button onClick={() => deleteUser(u)} className="text-rose-600 hover:text-rose-700" title="Delete user">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground w-16 text-right">{roleLabel(u.role)}</span>
            </div>
          ))}
        </div>
      )}

      {resetFor && (
        <ResetPasswordInline
          user={resetFor}
          onCancel={() => setResetFor(null)}
          onSave={async (pw) => { await patchUser(resetFor, { password: pw }); setResetFor(null); }}
        />
      )}
    </div>
  );
}

function ResetPasswordInline({ user, onCancel, onSave }: { user: CompanyUserRow; onCancel: () => void; onSave: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
      <div className="text-xs font-medium">Reset password for {user.name}</div>
      <p className="text-[11px] text-muted-foreground">
        Sets a new password immediately (overrides whatever they were using — use this when someone is locked out).
        Give it to them securely; they can change it afterward in My Account.
      </p>
      <div className="flex gap-2">
        <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ chars)" className="max-w-xs" />
        <Button size="sm" onClick={() => onSave(pw)} disabled={pw.length < 8}>Set password</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
