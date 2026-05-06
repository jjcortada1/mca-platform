'use client';

import { useEffect, useState } from 'react';
import {
  Card, CardHeader, CardTitle, CardContent, CardDescription,
  Button, Input, Textarea, Field, Label, Badge, PageHeader,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';

type Tab = 'branding' | 'email' | 'smtp' | 'commission' | 'fields' | 'users' | 'tiers';

const TAB_GROUPS: { title: string; tabs: { key: Tab; label: string }[] }[] = [
  {
    title: 'Brand',
    tabs: [{ key: 'branding', label: 'Branding' }],
  },
  {
    title: 'Email',
    tabs: [
      { key: 'email', label: 'Email mode' },
      { key: 'smtp', label: 'SMTP' },
      { key: 'fields', label: 'Email fields' },
    ],
  },
  {
    title: 'Financial',
    tabs: [{ key: 'commission', label: 'Commission rules' }],
  },
  {
    title: 'Team',
    tabs: [
      { key: 'users', label: 'Users' },
      { key: 'tiers', label: 'Funder tiers' },
    ],
  },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('branding');

  return (
    <div className="space-y-8 max-w-5xl">
      <PageHeader title="Settings" description="Branding, email, financial, and team configuration." />

      <div className="border-b border-border overflow-x-auto -mx-1">
        <div className="flex items-end gap-6 px-1">
          {TAB_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1 mb-1">
                {group.title}
              </div>
              <div className="flex">
                {group.tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-3 py-2 text-sm border-b-2 whitespace-nowrap transition-colors ${
                      tab === t.key
                        ? 'border-primary text-foreground font-medium'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {tab === 'branding' && <BrandingSection />}
      {tab === 'email' && <EmailModeSection />}
      {tab === 'smtp' && <SmtpSection />}
      {tab === 'commission' && <CommissionRulesSection />}
      {tab === 'fields' && <StructuredFieldsSection />}
      {tab === 'users' && <UsersSection />}
      {tab === 'tiers' && <TiersSection />}
    </div>
  );
}

/* -------- Branding -------- */

const COLOR_PRESETS = [
  { name: 'Deep Teal',    hsl: '184 70% 22%' },
  { name: 'Cobalt',       hsl: '215 75% 38%' },
  { name: 'Royal Indigo', hsl: '234 60% 38%' },
  { name: 'Forest',       hsl: '152 55% 28%' },
  { name: 'Burgundy',     hsl: '345 65% 32%' },
  { name: 'Slate',        hsl: '220 18% 28%' },
  { name: 'Charcoal',     hsl: '224 28% 18%' },
];

function BrandingSection() {
  const toast = useToast();
  const [productName, setProductName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [emailSignature, setEmailSignature] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings/company')
      .then((r) => r.json())
      .then((j) => {
        const d = j.data ?? {};
        setProductName(d.productName ?? '');
        setDisplayName(d.displayName ?? '');
        setLogoUrl(d.logoUrl ?? '');
        setPrimaryColor(d.primaryColor ?? '');
        setEmailSignature(d.emailSignature ?? '');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    const res = await fetch('/api/settings/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productName: productName || null,
        displayName: displayName || null,
        logoUrl: logoUrl || null,
        primaryColor: primaryColor || null,
        emailSignature: emailSignature || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success('Branding saved. Refresh to see all changes apply.');
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Product name and display name shown across the app and on the login page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Product name" hint="Shown in browser tab and sidebar header">
              <Input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="MCA Platform"
                maxLength={100}
              />
            </Field>
            <Field label="Display name" hint="Shown to users on login screen and footer">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Cortada Capital Group"
                maxLength={200}
              />
            </Field>
          </div>
          <Field label="Logo URL (optional)" hint="HTTPS URL to a square logo. Recommended 64×64 PNG or SVG.">
            <Input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              type="url"
            />
            {logoUrl && (
              <div className="mt-2 inline-flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt="Preview"
                  className="h-6 w-6 object-contain"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                />
                <span className="text-xs text-muted-foreground">Logo preview</span>
              </div>
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Primary color</CardTitle>
          <CardDescription>Used for buttons, links, and active navigation. Pick a preset or enter a custom HSL value.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((p) => (
              <button
                key={p.hsl}
                type="button"
                onClick={() => setPrimaryColor(p.hsl)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all ${
                  primaryColor === p.hsl ? 'border-foreground/40 bg-muted' : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <span
                  className="h-4 w-4 rounded-full border border-black/10"
                  style={{ backgroundColor: `hsl(${p.hsl})` }}
                />
                <span className="text-xs font-medium">{p.name}</span>
              </button>
            ))}
          </div>

          <Field label="Custom HSL value" hint='Format: "hue saturation% lightness%" — e.g. "184 70% 22%"'>
            <div className="flex items-center gap-2">
              <span
                className="h-9 w-9 rounded-md border border-border shrink-0"
                style={{ backgroundColor: primaryColor ? `hsl(${primaryColor})` : 'transparent' }}
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="184 70% 22%"
                className="flex-1 font-mono text-xs"
              />
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email signature</CardTitle>
          <CardDescription>Optional default signature appended to deal submission emails.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={5}
            value={emailSignature}
            onChange={(e) => setEmailSignature(e.target.value)}
            placeholder="Best,&#10;The Cortada Team&#10;cortadacapitalgroup.com"
            maxLength={2000}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>Save branding</Button>
      </div>
    </div>
  );
}

/* -------- Email Mode -------- */

function EmailModeSection() {
  const toast = useToast();
  const [mode, setMode] = useState<'shared' | 'per_rep'>('per_rep');
  const [globalCc, setGlobalCc] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/settings/company')
      .then((r) => r.json())
      .then((j) => {
        if (j.data) {
          setMode(j.data.emailMode);
          setGlobalCc((j.data.globalCcEmails ?? []).join(', '));
        }
        setLoaded(true);
      });
  }, []);

  async function save() {
    setSaving(true);
    const cc = globalCc.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const res = await fetch('/api/settings/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailMode: mode, globalCcEmails: cc }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success('Email settings saved.');
  }

  if (!loaded) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Email send mode</CardTitle>
          <CardDescription>Pick how outbound deal emails are sent.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-3 p-3 rounded border border-border cursor-pointer hover:bg-muted/30">
            <input type="radio" checked={mode === 'shared'} onChange={() => setMode('shared')} className="mt-1" />
            <div>
              <div className="font-medium text-sm">Shared company email</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                One SMTP config for everyone. All deals send from the same address.
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 rounded border border-border cursor-pointer hover:bg-muted/30">
            <input type="radio" checked={mode === 'per_rep'} onChange={() => setMode('per_rep')} className="mt-1" />
            <div>
              <div className="font-medium text-sm">Per-rep email</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Each rep configures their own SMTP. Deals send from the rep&apos;s personal address.
              </div>
            </div>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Global CC</CardTitle>
          <CardDescription>Always CC&apos;d on every outbound deal email. Comma or space separated.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input value={globalCc} onChange={(e) => setGlobalCc(e.target.value)} placeholder="ops@cortada.com, jj@cortada.com" />
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
    </div>
  );
}

/* -------- SMTP -------- */

function SmtpSection() {
  const toast = useToast();
  const [mode, setMode] = useState<'shared' | 'per_rep' | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState('');
  const [hasConfig, setHasConfig] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/smtp')
      .then((r) => r.json())
      .then((j) => {
        if (j.data) {
          setMode(j.data.mode);
          setHasConfig(j.data.hasConfig);
          if (j.data.host) setHost(j.data.host);
          if (j.data.port) setPort(String(j.data.port));
          if (j.data.user) setUser(j.data.user);
          if (j.data.from) setFrom(j.data.from);
        }
        setLoaded(true);
      });
  }, []);

  async function verify() {
    setVerifying(true);
    setVerifyMsg(null);
    const res = await fetch('/api/settings/smtp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: parseInt(port), user, pass, from }),
    });
    const j = await res.json();
    setVerifying(false);
    setVerifyMsg(j.success ? '✓ Connection verified' : `✗ ${j.error || 'Verification failed'}`);
  }

  async function save() {
    const res = await fetch('/api/settings/smtp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: parseInt(port), user, pass, from }),
    });
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success('SMTP credentials saved.');
    setPass('');
    setHasConfig(true);
  }

  if (!loaded) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>SMTP credentials</CardTitle>
        <CardDescription>
          {mode === 'shared'
            ? 'Configure the company-wide SMTP for all reps.'
            : 'Configure your personal SMTP. Other reps configure their own.'}
          {hasConfig && <Badge variant="success" className="ml-2">configured</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP Host" required>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" />
          </Field>
          <Field label="Port">
            <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" />
          </Field>
          <Field label="Username (email)" required>
            <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="me@company.com" />
          </Field>
          <Field label="App password" required={!hasConfig}>
            <Input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={hasConfig ? '•••••••• (leave blank to keep)' : 'app password'}
            />
          </Field>
          <div className="col-span-2">
            <Field label="From address">
              <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="you@company.com" />
            </Field>
          </div>
        </div>

        {verifyMsg && (
          <div className={`text-sm ${verifyMsg.startsWith('✓') ? 'text-green-600' : 'text-destructive'}`}>
            {verifyMsg}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={verify} disabled={verifying || !host || !user || !pass}>
            {verifying ? 'Verifying…' : 'Verify connection'}
          </Button>
          <Button onClick={save} disabled={!host || !user || (!hasConfig && !pass)}>
            Save credentials
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          For Gmail/Workspace, use an <a className="underline" href="https://support.google.com/accounts/answer/185833" target="_blank">App Password</a>, not your real password.
          Outlook 365 and most providers also require app passwords with 2FA enabled.
        </p>
      </CardContent>
    </Card>
  );
}

/* -------- Commission rules -------- */

interface CommissionRule {
  id: string;
  threshold: string;
  commissionPct: string;
  sortOrder: number;
}

function CommissionRulesSection() {
  const toast = useToast();
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/settings/commission-rules');
    const j = await res.json();
    // API now returns numbers, but historic strings remain coercible
    const normalized = (j.data ?? []).map((r: CommissionRule) => ({
      ...r,
      threshold: typeof r.threshold === 'number' ? String(r.threshold) : r.threshold,
      commissionPct: typeof r.commissionPct === 'number' ? String(r.commissionPct) : r.commissionPct,
    }));
    setRules(normalized);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function update(idx: number, field: keyof CommissionRule, val: string) {
    setRules((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));
  }

  function addRule() {
    setRules((prev) => [...prev, {
      id: '',
      threshold: '1.50',
      commissionPct: '12',
      sortOrder: prev.length,
    }]);
  }

  function removeRule(idx: number) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    const res = await fetch('/api/settings/commission-rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: rules.map((r, i) => ({
          threshold: Number(r.threshold),
          commissionPct: Number(r.commissionPct),
          sortOrder: i,
        })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success('Commission rules saved.');
    load();
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commission rules</CardTitle>
        <CardDescription>
          Factor rate brackets. A factor rate ≤ threshold gets that commission %. Below the lowest threshold = 0%.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2">Up to factor rate</th>
              <th className="py-2">Commission %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...rules].sort((a, b) => parseFloat(a.threshold) - parseFloat(b.threshold)).map((r) => {
              const idx = rules.indexOf(r);
              return (
                <tr key={idx} className="border-b border-border">
                  <td className="py-2 pr-3">
                    <Input
                      type="number"
                      step="0.001"
                      value={r.threshold}
                      onChange={(e) => update(idx, 'threshold', e.target.value)}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      type="number"
                      step="0.1"
                      value={r.commissionPct}
                      onChange={(e) => update(idx, 'commissionPct', e.target.value)}
                    />
                  </td>
                  <td className="py-2">
                    <button onClick={() => removeRule(idx)} className="text-xs text-muted-foreground hover:text-destructive">
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRule}>+ Add bracket</Button>
          <Button size="sm" onClick={save}>Save rules</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------- Structured fields -------- */

interface FieldDef {
  id: string;
  fieldLabel: string;
  fieldKey: string;
  sortOrder: number;
}

function StructuredFieldsSection() {
  const toast = useToast();
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/settings/structured-fields');
    const j = await r.json();
    setFields(j.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function update(idx: number, field: keyof FieldDef, val: string) {
    setFields((prev) => prev.map((f, i) => i === idx ? { ...f, [field]: val } : f));
  }

  function add() {
    setFields((prev) => [...prev, { id: '', fieldLabel: '', fieldKey: '', sortOrder: prev.length }]);
  }

  function remove(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    const res = await fetch('/api/settings/structured-fields', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: fields.map((f, i) => ({
          fieldLabel: f.fieldLabel,
          fieldKey: f.fieldKey || f.fieldLabel.toLowerCase().replace(/\s+/g, '_'),
          sortOrder: i,
        })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success('Email fields saved.');
    load();
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Structured email fields</CardTitle>
        <CardDescription>Fields that appear on every Shop Deal form, included in the email body.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {fields.map((f, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input
              placeholder="Field label (e.g., Monthly Revenue)"
              value={f.fieldLabel}
              onChange={(e) => update(idx, 'fieldLabel', e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder="key"
              value={f.fieldKey}
              onChange={(e) => update(idx, 'fieldKey', e.target.value)}
              className="w-40"
            />
            <button onClick={() => remove(idx)} className="text-xs text-muted-foreground hover:text-destructive">
              Remove
            </button>
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={add}>+ Add field</Button>
          <Button size="sm" onClick={save}>Save fields</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------- Users -------- */

interface AppUser {
  id: string;
  email: string;
  name: string;
  role: 'company_admin' | 'rep';
  isActive: boolean;
  permissions: string[];
}

const ALL_PERMS = [
  'deals.view', 'deals.shop', 'deals.submit', 'submissions.view', 'submissions.edit',
  'active_deals.view', 'active_deals.edit', 'funders.view', 'funders.edit',
  'funded_board.view', 'funded_board.edit', 'calculator.use', 'info.view', 'info.edit',
  'settings.manage',
];

function UsersSection() {
  const toast = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(AppUser & { password?: string }) | null>(null);

  async function load() {
    setLoading(true);
    const j = await (await fetch('/api/users')).json();
    setUsers(j.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    const body = {
      name: editing.name,
      email: editing.email,
      role: editing.role,
      isActive: editing.isActive,
      permissions: editing.permissions,
      password: editing.password,
    };
    const res = editing.id
      ? await fetch(`/api/users/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = await res.json();
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success(editing.id ? 'User updated.' : 'User created.');
    setEditing(null);
    load();
  }

  function newUser() {
    setEditing({ id: '', email: '', name: '', role: 'rep', isActive: true, permissions: [], password: '' });
  }

  function togglePerm(p: string) {
    if (!editing) return;
    setEditing({
      ...editing,
      permissions: editing.permissions.includes(p) ? editing.permissions.filter((x) => x !== p) : [...editing.permissions, p],
    });
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={newUser}>+ Add user</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border hover:bg-muted/30 cursor-pointer" onClick={() => setEditing({ ...u, password: '' })}>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3"><Badge variant="outline">{u.role}</Badge></td>
                  <td className="px-4 py-3">{u.isActive ? <Badge variant="success">active</Badge> : <Badge variant="outline">inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setEditing(null)}>
          <div className="w-full max-w-xl bg-background border-l border-border h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">{editing.id ? 'Edit user' : 'New user'}</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                <Button size="sm" onClick={save}>Save</Button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <Field label="Name" required><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Email" required><Input value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
              <Field label={editing.id ? 'Password (leave blank to keep)' : 'Password'} required={!editing.id}>
                <Input type="password" value={editing.password ?? ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
              </Field>
              <Field label="Role">
                <select
                  value={editing.role}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value as 'company_admin' | 'rep' })}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="rep">Rep</option>
                  <option value="company_admin">Company admin</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
                Active
              </label>

              <div>
                <Label className="mb-2 block">Permissions</Label>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {ALL_PERMS.map((p) => (
                    <label key={p} className="flex items-center gap-2">
                      <input type="checkbox" checked={editing.permissions.includes(p)} onChange={() => togglePerm(p)} />
                      <span className="font-mono text-xs">{p}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">Company admins implicitly have all permissions.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------- Funder tiers -------- */

interface Tier { id: string; name: string; sortOrder: number }

function TiersSection() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');

  async function load() {
    setLoading(true);
    const j = await (await fetch('/api/funder-tiers')).json();
    setTiers(j.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function add() {
    if (!newName.trim()) return;
    await fetch('/api/funder-tiers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setNewName('');
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this tier? Funder assignments to it will be removed.')) return;
    await fetch(`/api/funder-tiers/${id}`, { method: 'DELETE' });
    load();
  }

  async function rename(id: string, name: string) {
    await fetch(`/api/funder-tiers/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    load();
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funder tiers</CardTitle>
        <CardDescription>Categorize funders (e.g., A-paper, Subprime, Reverse, Real Estate).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {tiers.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <Input
                defaultValue={t.name}
                onBlur={(e) => { if (e.target.value !== t.name) rename(t.id, e.target.value); }}
                className="flex-1"
              />
              <Button variant="ghost" size="sm" onClick={() => remove(t.id)}>Delete</Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 border-t border-border pt-3">
          <Input placeholder="New tier name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button onClick={add}>Add</Button>
        </div>
      </CardContent>
    </Card>
  );
}
