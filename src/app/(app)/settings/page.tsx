'use client';

import { useEffect, useState } from 'react';
import {
  Card, CardHeader, CardTitle, CardContent, CardDescription,
  Button, Input, Textarea, Field, Label, Badge, PageHeader,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';

type Tab = 'branding' | 'email' | 'smtp' | 'commission' | 'fields' | 'users' | 'tiers' | 'options' | 'security';

const TAB_GROUPS: { title: string; tabs: { key: Tab; label: string }[] }[] = [
  {
    title: 'Account',
    tabs: [{ key: 'security', label: 'Security' }],
  },
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
    title: 'Matching',
    tabs: [
      { key: 'tiers', label: 'Funder tiers' },
      { key: 'options', label: 'Match options' },
    ],
  },
  {
    title: 'Team',
    tabs: [{ key: 'users', label: 'Users' }],
  },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('security');

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
      {tab === 'options' && <MatchOptionsSection />}
      {tab === 'security' && <SecuritySection />}
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

    // Client-side validation with clear messages
    if (!editing.name || editing.name.trim().length < 2) {
      toast.error('Name must be at least 2 characters.');
      return;
    }
    if (!editing.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editing.email)) {
      toast.error('Enter a valid email address.');
      return;
    }
    // Password required on create; on edit it's optional (blank = keep current)
    if (!editing.id) {
      if (!editing.password || editing.password.length < 8) {
        toast.error('Password must be at least 8 characters.');
        return;
      }
    } else if (editing.password && editing.password.length > 0 && editing.password.length < 8) {
      toast.error('New password must be at least 8 characters (or leave blank to keep current).');
      return;
    }

    const body: Record<string, unknown> = {
      name: editing.name.trim(),
      email: editing.email.trim().toLowerCase(),
      role: editing.role,
      isActive: editing.isActive,
      permissions: editing.permissions,
    };
    // Only include password if one was typed
    if (editing.password && editing.password.length > 0) {
      body.password = editing.password;
    }

    const res = editing.id
      ? await fetch(`/api/users/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
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
              <Field label={editing.id ? 'Password (leave blank to keep)' : 'Password'} required={!editing.id} hint="At least 8 characters.">
                <Input type="password" value={editing.password ?? ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} autoComplete="new-password" />
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
  const toast = useToast();
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
    const res = await fetch('/api/funder-tiers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (!res.ok) {
      toast.error('Failed to add tier.');
      return;
    }
    toast.success('Tier added.');
    setNewName('');
    load();
  }

  async function remove(t: Tier) {
    if (!confirm(`Delete "${t.name}"? Funder assignments to it will be removed.`)) return;
    const res = await fetch(`/api/funder-tiers/${t.id}`, { method: 'DELETE' });
    if (res.ok) toast.success('Tier deleted.');
    else toast.error('Delete failed.');
    load();
  }

  async function rename(id: string, name: string) {
    const res = await fetch(`/api/funder-tiers/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      toast.error('Rename failed.');
      load();
      return;
    }
    toast.success('Tier renamed.');
  }

  async function move(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= tiers.length) return;
    const reordered = [...tiers];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setTiers(reordered);
    const res = await fetch('/api/funder-tiers/reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: reordered.map((t) => t.id) }),
    });
    if (!res.ok) {
      toast.error('Reorder failed.');
      load();
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funder tiers</CardTitle>
        <CardDescription>Categorize funders (e.g., A-paper, Subprime, Reverse, Real Estate). Drag with arrows to reorder.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {tiers.map((t, i) => (
            <div key={t.id} className="flex items-center gap-1.5 group">
              <div className="flex flex-col">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 leading-none text-xs"
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === tiers.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 leading-none text-xs"
                  title="Move down"
                >
                  ▼
                </button>
              </div>
              <Input
                defaultValue={t.name}
                onBlur={(e) => { if (e.target.value !== t.name) rename(t.id, e.target.value); }}
                className="flex-1"
              />
              <Button variant="ghost" size="sm" onClick={() => remove(t)}>Delete</Button>
            </div>
          ))}
          {tiers.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4">No tiers yet. Add one below.</div>
          )}
        </div>
        <div className="flex gap-2 border-t border-border pt-3">
          <Input
            placeholder="New tier name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <Button onClick={add} disabled={!newName.trim()}>Add</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   MATCH OPTIONS — editable dropdowns for deal shop intake
   ============================================================ */

interface MatchOption {
  id?: string;
  value: string;
  label: string;
  meta?: Record<string, unknown> | null;
}

const MATCH_KINDS: { key: string; title: string; description: string; metaFields?: { key: string; label: string; type: 'number' }[] }[] = [
  {
    key: 'credit_range',
    title: 'Credit ranges',
    description: 'Shown in deal shop credit dropdown. minScore is the floor used by the matching engine.',
    metaFields: [{ key: 'minScore', label: 'Min score floor', type: 'number' }],
  },
  {
    key: 'revenue_range',
    title: 'Revenue ranges',
    description: 'Shown in deal shop revenue dropdown. minRevenue/maxRevenue define the range.',
    metaFields: [
      { key: 'minRevenue', label: 'Min $', type: 'number' },
      { key: 'maxRevenue', label: 'Max $', type: 'number' },
    ],
  },
  {
    key: 'industry',
    title: 'Industries',
    description: 'Shown in deal shop industry dropdown and used as funder restriction labels. "Other" must exist to allow skipping.',
  },
  {
    key: 'deal_type',
    title: 'Deal types',
    description: 'Shown as buttons in deal shop. Use values "standard_mca" and "reverse_consolidation" to keep matching engine compatible.',
  },
  {
    key: 'position_option',
    title: 'Positions',
    description: 'Shown in deal shop positions dropdown.',
  },
];

function MatchOptionsSection() {
  const [activeKind, setActiveKind] = useState(MATCH_KINDS[0].key);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {MATCH_KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setActiveKind(k.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
              activeKind === k.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
            }`}
          >
            {k.title}
          </button>
        ))}
      </div>
      <MatchOptionsKindEditor key={activeKind} kind={activeKind} />
    </div>
  );
}

function MatchOptionsKindEditor({ kind }: { kind: string }) {
  const toast = useToast();
  const def = MATCH_KINDS.find((k) => k.key === kind)!;
  const [options, setOptions] = useState<MatchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/settings/match-options?kind=${kind}`);
    const j = await res.json();
    setOptions((j.data ?? []).map((o: MatchOption & { sortOrder?: number }) => ({
      id: o.id,
      value: o.value,
      label: o.label,
      meta: o.meta ?? {},
    })));
    setLoading(false);
    setDirty(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind]);

  function update(idx: number, field: 'value' | 'label', val: string) {
    setOptions((prev) => prev.map((o, i) => i === idx ? { ...o, [field]: val } : o));
    setDirty(true);
  }
  function updateMeta(idx: number, key: string, val: string) {
    setOptions((prev) => prev.map((o, i) => {
      if (i !== idx) return o;
      const meta: Record<string, unknown> = { ...(o.meta ?? {}) };
      if (val === '') meta[key] = null;
      else {
        const n = Number(val);
        meta[key] = Number.isFinite(n) ? n : null;
      }
      return { ...o, meta };
    }));
    setDirty(true);
  }
  function move(idx: number, dir: -1 | 1) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= options.length) return;
    const reordered = [...options];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setOptions(reordered);
    setDirty(true);
  }
  function remove(idx: number) {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }
  function add() {
    setOptions((prev) => [...prev, { value: '', label: '', meta: {} }]);
    setDirty(true);
  }

  async function save() {
    // Filter empties
    const valid = options.filter((o) => o.value.trim() && o.label.trim());
    setSaving(true);
    const res = await fetch('/api/settings/match-options', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        options: valid.map((o, i) => ({
          value: o.value.trim(),
          label: o.label.trim(),
          sortOrder: i,
          meta: o.meta ?? null,
        })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success(`${def.title} saved.`);
    load();
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{def.title}</CardTitle>
        <CardDescription>{def.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {options.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4">
              No options yet. Add one below.
            </div>
          )}
          {options.map((o, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded border border-border bg-card">
              <div className="flex flex-col pt-2">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 leading-none text-xs"
                  title="Move up"
                >▲</button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === options.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 leading-none text-xs"
                  title="Move down"
                >▼</button>
              </div>
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Value" hint="Internal — lowercase + underscores. Don't change after creation if funders reference it.">
                  <Input
                    value={o.value}
                    onChange={(e) => update(i, 'value', e.target.value)}
                    placeholder="e.g. above_700"
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="Label" hint="Shown to users in the dropdown.">
                  <Input
                    value={o.label}
                    onChange={(e) => update(i, 'label', e.target.value)}
                    placeholder="e.g. Above 700"
                  />
                </Field>
                {def.metaFields?.map((mf) => (
                  <Field key={mf.key} label={mf.label}>
                    <Input
                      type="number"
                      value={
                        o.meta?.[mf.key] === null || o.meta?.[mf.key] === undefined
                          ? ''
                          : String(o.meta[mf.key])
                      }
                      onChange={(e) => updateMeta(i, mf.key, e.target.value)}
                      placeholder="(none)"
                    />
                  </Field>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => remove(i)}>Delete</Button>
            </div>
          ))}
        </div>

        <div className="flex justify-between border-t border-border pt-3">
          <Button variant="outline" onClick={add}>+ Add option</Button>
          <Button onClick={save} loading={saving} disabled={!dirty}>Save changes</Button>
        </div>

        <div className="text-[10px] text-muted-foreground/80 leading-relaxed mt-2 p-2 bg-muted/30 rounded">
          <strong>Tip:</strong> Saving replaces all options for this kind. Existing funders that reference removed values will still match — only the dropdown shrinks.
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   SECURITY — change password with 2-step email verification
   ============================================================ */

function SecuritySection() {
  const toast = useToast();
  const [phase, setPhase] = useState<'form' | 'verify'>('form');

  // Phase 1 fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Phase 2 fields
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [devCode, setDevCode] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  function resetAll() {
    setPhase('form');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setCode('');
    setSentTo('');
    setDevCode(null);
    setBusy(false);
  }

  async function requestCode() {
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/account/password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || 'Could not start verification.');
        return;
      }
      setSentTo(j.sentTo || 'your email');
      setEmailConfigured(j.emailConfigured !== false);
      setDevCode(j.devCode ?? null);
      setPhase('verify');
      if (j.emailConfigured === false) {
        toast.info('Email isn\u2019t set up yet — your code is shown below so you can continue.');
      } else {
        toast.success(`Verification code sent to ${j.sentTo}.`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (!/^\d{6}$/.test(code)) {
      toast.error('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/account/password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || 'Verification failed.');
        return;
      }
      toast.success('Password changed successfully.');
      resetAll();
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    // Re-run request with the same stashed passwords
    if (!currentPassword || !newPassword) {
      toast.error('Start again — your session for this change expired.');
      resetAll();
      return;
    }
    await requestCode();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          For your security, changing your password takes two steps: confirm your current
          password, then enter a 6-digit code we email to verify it&apos;s really you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        {phase === 'form' ? (
          <>
            <Field label="Current password">
              <Input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
            <Field label="New password" hint="At least 8 characters.">
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && requestCode()}
              />
            </Field>
            <Button
              onClick={requestCode}
              loading={busy}
              disabled={!currentPassword || !newPassword || !confirmPassword}
            >
              Send verification code
            </Button>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              We sent a 6-digit code to <strong>{sentTo}</strong>. Enter it below to confirm
              your new password. The code expires in 10 minutes.
              {!emailConfigured && (
                <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 space-y-1.5">
                  <div>Email isn&apos;t set up yet, so here&apos;s your code directly:</div>
                  {devCode && (
                    <div className="text-center font-mono text-lg font-bold tracking-[0.4em] bg-white border border-amber-300 rounded py-1.5">
                      {devCode}
                    </div>
                  )}
                  <div className="text-amber-700">
                    To get codes by email instead, an admin can set the
                    <code> SYSTEM_SMTP_*</code> secrets.
                  </div>
                </div>
              )}
            </div>
            <Field label="Verification code">
              <Input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="text-center text-2xl tracking-[0.5em] font-mono"
                onKeyDown={(e) => e.key === 'Enter' && confirmCode()}
                autoFocus
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button onClick={confirmCode} loading={busy} disabled={code.length !== 6}>
                Confirm &amp; change password
              </Button>
              <Button variant="ghost" onClick={resetAll} disabled={busy}>
                Cancel
              </Button>
            </div>
            <button
              onClick={resendCode}
              disabled={busy}
              className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50"
            >
              Didn&apos;t get it? Resend code
            </button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
