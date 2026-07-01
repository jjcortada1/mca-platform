'use client';

import { useEffect, useState } from 'react';
import {
  Card, CardHeader, CardTitle, CardContent, CardDescription,
  Button, Input, Textarea, Field, Label, Badge, PageHeader,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import {
  Palette, Mail, Send, FileText, DollarSign, Layers, ListChecks,
  Users as UsersIcon, GitBranch, Database, ShieldCheck, Menu as MenuIcon,
  Trash2, Sparkles,
} from 'lucide-react';

type Tab = 'branding' | 'email' | 'smtp' | 'commission' | 'fields' | 'users' | 'tiers' | 'options' | 'security' | 'sheets' | 'leadsources' | 'backup' | 'funded' | 'sidebar' | 'celebration';

// Flatter, friendlier settings nav. Each entry has an icon + one-line
// description so the user can scan and find what they want without reading
// tab labels twice.
const TAB_GROUPS: {
  title: string;
  tabs: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[];
}[] = [
  {
    title: 'General',
    tabs: [
      { key: 'branding', label: 'Branding', icon: Palette, description: 'Logo, colors, company name' },
      { key: 'sidebar', label: 'Sidebar order', icon: MenuIcon, description: 'Rearrange the left navigation menu' },
      // Funded celebration is admin-customizable — confetti + message text.
      // Lives in General because it's a company-wide personality knob, like
      // branding. Hidden behind admin gating (settings page itself is admin
      // only via permissions.manage).
      { key: 'celebration', label: 'Funded celebration', icon: Sparkles, description: 'Confetti + message when a deal funds' },
      { key: 'security', label: 'Security', icon: ShieldCheck, description: 'Your password and audit log' },
    ],
  },
  {
    title: 'Email',
    tabs: [
      { key: 'email', label: 'Email mode', icon: Mail, description: 'Shared inbox vs per-rep' },
      { key: 'smtp', label: 'SMTP setup', icon: Send, description: 'Connect your sending account' },
      { key: 'fields', label: 'Email fields', icon: FileText, description: 'Custom deal info fields' },
      { key: 'funded', label: 'Funded email template', icon: FileText, description: 'Subject + fields for the funded email' },
    ],
  },
  {
    title: 'Deals',
    tabs: [
      { key: 'tiers', label: 'Funder tiers', icon: Layers, description: 'A-Paper, Subprime, etc.' },
      { key: 'options', label: 'Industries, states, more', icon: ListChecks, description: 'Dropdown options used everywhere' },
      { key: 'commission', label: 'Commission rules', icon: DollarSign, description: 'Default split + broker fee' },
    ],
  },
  {
    title: 'Team',
    tabs: [
      { key: 'users', label: 'Reps & admins', icon: UsersIcon, description: 'Invite, deactivate, permissions' },
      { key: 'leadsources', label: 'Lead sources', icon: GitBranch, description: 'Referral partner accounts' },
    ],
  },
  {
    title: 'Backup',
    tabs: [
      { key: 'sheets', label: 'Live Google Sheet backup', icon: Database, description: 'Auto-mirror every change to a Sheet — append-only' },
      { key: 'backup', label: 'Manual JSON download', icon: Database, description: 'One-click full export to your computer' },
    ],
  },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('branding');

  // Find active item for header display
  const activeItem = TAB_GROUPS.flatMap((g) => g.tabs).find((t) => t.key === tab);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your company, team, deals, and integrations." />

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-10">
        {/* Sidebar nav — vertical, grouped, scrollable on mobile */}
        <aside className="lg:w-64 shrink-0">
          <nav className="space-y-5 lg:sticky lg:top-6">
            {TAB_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5 px-2">
                  {group.title}
                </div>
                <div className="space-y-0.5">
                  {group.tabs.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                          active
                            ? 'bg-foreground text-background'
                            : 'hover:bg-muted text-foreground'
                        }`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${active ? '' : 'text-muted-foreground'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium leading-tight">{t.label}</div>
                          <div className={`text-[11px] leading-tight mt-0.5 ${active ? 'text-background/70' : 'text-muted-foreground'}`}>
                            {t.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main settings panel */}
        <div className="flex-1 min-w-0 space-y-4">
          {activeItem && (
            <div className="pb-2 border-b border-border">
              <h2 className="text-lg font-semibold tracking-tight">{activeItem.label}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{activeItem.description}</p>
            </div>
          )}

          {tab === 'branding' && <BrandingSection />}
          {tab === 'sidebar' && <SidebarOrderSection />}
          {tab === 'celebration' && <CelebrationSection />}
          {tab === 'email' && <EmailModeSection />}
          {tab === 'smtp' && <SmtpSection />}
          {tab === 'commission' && <CommissionRulesSection />}
          {tab === 'fields' && <StructuredFieldsSection />}
          {tab === 'funded' && <FundedTemplateSection />}
          {tab === 'users' && <UsersSection />}
          {tab === 'tiers' && <TiersSection />}
          {tab === 'options' && <MatchOptionsSection />}
          {tab === 'security' && <SecuritySection />}
          {tab === 'backup' && <BackupSection />}
          {tab === 'sheets' && <SheetSyncSection />}
          {tab === 'leadsources' && <LeadSourcesSection />}
        </div>
      </div>
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
          <Field label="Logo" hint="Upload a square image (PNG, JPG, SVG, WebP, up to 1MB) — or paste an https URL.">
            <LogoInput value={logoUrl} onChange={setLogoUrl} />
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
          <CardDescription>
            Signatures are personal — each user sets their own in one place:{' '}
            <a href="/account" className="text-primary hover:underline">My Account → Email signature</a>.
            Paste it straight from Gmail (fonts, logo and all) and it&apos;s used on every email that user sends.
          </CardDescription>
        </CardHeader>
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
      body: JSON.stringify({ host, port: parseInt(port), user, pass, from, persistOnSuccess: true }),
    });
    const j = await res.json();
    setVerifying(false);
    if (j.success) {
      setVerifyMsg(j.saved ? '✓ Connection verified and saved. You can now send deals.' : '✓ Connection verified.');
      if (j.saved) {
        setPass('');
        setHasConfig(true);
      }
    } else {
      setVerifyMsg(`✗ ${j.error || 'Verification failed'}`);
    }
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
          <Button onClick={verify} disabled={verifying || !host || !user || !pass}>
            {verifying ? 'Verifying & saving…' : 'Verify & save'}
          </Button>
          {hasConfig && (
            <Button variant="outline" onClick={save} disabled={!host || !user}>
              Save without verifying
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          <strong>Click <em>Verify &amp; save</em> once.</strong> That single click both checks Gmail accepts the credentials AND stores them — you don&apos;t need to click anything else after.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          For Gmail/Workspace, use a 16-character <a className="underline" href="https://myaccount.google.com/apppasswords" target="_blank">App Password</a> (NOT your regular password). 2-Step Verification must be on first.
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
  role: 'company_admin' | 'rep' | 'lead_source';
  isActive: boolean;
  permissions: string[];
  leadSourceId?: string | null;
}

const ALL_PERMS = [
  'deals.view', 'deals.shop', 'deals.submit', 'submissions.view', 'submissions.edit',
  'active_deals.view', 'active_deals.edit', 'funders.view', 'funders.edit',
  'funded_board.view', 'funded_board.edit', 'calculator.use', 'info.view', 'info.edit',
  'commissions.view', 'commissions.manage',
  'settings.manage',
];

// Friendly labels for permission keys (shown next to the toggle).
const PERM_LABELS: Record<string, string> = {
  'commissions.view': 'commissions.view — see own commissions',
  'commissions.manage': 'commissions.manage — manage all commissions (admin)',
};

function UsersSection() {
  const toast = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(AppUser & { password?: string }) | null>(null);
  const [leadSourceList, setLeadSourceList] = useState<{ id: string; name: string }[]>([]);
  // Delete confirmation state. When non-null the modal is open. Standard
  // confirm-before-destroy pattern used everywhere in the app.
  const [deleting, setDeleting] = useState<{ id: string; name: string; email: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function load() {
    setLoading(true);
    const j = await (await fetch('/api/users')).json();
    setUsers(j.data ?? []);
    try {
      const ls = await (await fetch('/api/lead-sources')).json();
      setLeadSourceList((ls.leadSources ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
    } catch { /* ignore */ }
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

    if (editing.role === 'lead_source' && !editing.leadSourceId) {
      toast.error('Pick which lead source this login is linked to.');
      return;
    }

    const body: Record<string, unknown> = {
      name: editing.name.trim(),
      email: editing.email.trim().toLowerCase(),
      role: editing.role,
      isActive: editing.isActive,
      permissions: editing.permissions,
    };
    if (editing.role === 'lead_source') body.leadSourceId = editing.leadSourceId;
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

  /**
   * Delete a user (rep / admin / lead source login) from the company.
   *
   * Server-side guards already enforce:
   *   • Cannot delete yourself.
   *   • Cannot delete the last active admin.
   *   • Company admins cannot delete master_admins.
   * On any of those, the server returns an error message we surface to the
   * user via toast. The optimistic local update removes the row only when
   * the API call succeeds.
   *
   * Note on deal ownership: deleting a rep cascades `assignedRepId → NULL`
   * on every deal they owned (via the FK's `onDelete: 'set null'` in the
   * schema). Those deals show up in /submissions as "Unassigned · assign"
   * so the admin can pick a new owner.
   */
  async function performDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    const res = await fetch(`/api/users/${deleting.id}`, { method: 'DELETE' });
    setDeleteLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not delete user.');
      return;
    }
    toast.success('User deleted.');
    // Optimistic local update so the row disappears immediately. Also
    // close the edit drawer if the deleted user was being edited.
    setUsers((arr) => arr.filter((u) => u.id !== deleting.id));
    if (editing?.id === deleting.id) setEditing(null);
    setDeleting(null);
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
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border hover:bg-muted/30 cursor-pointer" onClick={() => setEditing({ ...u, password: '' })}>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3"><Badge variant="outline">{u.role}</Badge></td>
                  <td className="px-4 py-3">{u.isActive ? <Badge variant="success">active</Badge> : <Badge variant="outline">inactive</Badge>}</td>
                  {/* Inline delete — single click opens the confirm modal.
                      Stop propagation so the row's own onClick (which opens
                      the edit drawer) doesn't fire at the same time. */}
                  <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setDeleting({ id: u.id, name: u.name, email: u.email })}
                      title="Delete this user"
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Confirmation modal — uses the shared component so the destruction
          flow looks the same as deletes in /portfolio, etc. */}
      <ConfirmDialog
        open={!!deleting}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description={
          deleting
            ? `This permanently removes ${deleting.email}'s login. Any deals they own will become Unassigned (you can reassign them from Submissions or Active Deals).`
            : ''
        }
        confirmLabel="Delete user"
        destructive
        loading={deleteLoading}
        onConfirm={performDelete}
        onCancel={() => !deleteLoading && setDeleting(null)}
      />

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setEditing(null)}>
          <div className="w-full max-w-xl bg-background border-l border-border h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold">{editing.id ? 'Edit user' : 'New user'}</h2>
              <div className="flex gap-2">
                {/* Delete is only available for existing users (not for the
                    new-user form, which has nothing to delete yet). */}
                {editing.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleting({ id: editing.id, name: editing.name, email: editing.email })}
                    className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    Delete
                  </Button>
                )}
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
                  onChange={(e) => setEditing({ ...editing, role: e.target.value as 'company_admin' | 'rep' | 'lead_source' })}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="rep">Rep</option>
                  <option value="company_admin">Company admin</option>
                  <option value="lead_source">Lead source (restricted portal)</option>
                </select>
              </Field>
              {editing.role === 'lead_source' && (
                <Field label="Linked lead source" hint="This login will see ONLY this lead source's commissions.">
                  <select
                    value={editing.leadSourceId ?? ''}
                    onChange={(e) => setEditing({ ...editing, leadSourceId: e.target.value || null })}
                    className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— Pick a lead source —</option>
                    {leadSourceList.map((ls) => <option key={ls.id} value={ls.id}>{ls.name}</option>)}
                  </select>
                </Field>
              )}
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
                      <span className="font-mono text-xs">{PERM_LABELS[p] ?? p}</span>
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

const MATCH_KINDS: { key: string; title: string; description: string; simple?: boolean; metaFields?: { key: string; label: string; type: 'number' }[] }[] = [
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
    description: 'Industries that appear in the deal shop and as funder restriction tags. Just type the name — the system uses it everywhere.',
    simple: true,
  },
  {
    key: 'state',
    title: 'States',
    description: 'Which states appear in the deal shop dropdown. Use 2-letter codes (FL, CA, NY). Leave empty to show all 50 states.',
    simple: true,
  },
  {
    key: 'deal_type',
    title: 'Deal types',
    description: 'Shown as buttons in deal shop. Use values "standard_mca" and "reverse_consolidation" to keep matching engine compatible.',
  },
  {
    key: 'position_option',
    title: 'Positions',
    description: 'Position options shown in the deal shop dropdown.',
    simple: true,
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
    // Allow rows where the user filled in either field — the server will
    // mirror missing value↔label automatically.
    const valid = options.filter((o) => (o.value?.trim() || o.label?.trim()));
    setSaving(true);
    const res = await fetch('/api/settings/match-options', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        options: valid.map((o, i) => ({
          value: (o.value ?? '').trim() || (o.label ?? '').trim(),
          label: (o.label ?? '').trim() || (o.value ?? '').trim(),
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
                {def.simple ? (
                  // SIMPLE MODE — one input. Whatever you type IS the value AND the label.
                  // Server will mirror it into both columns automatically.
                  <Field label="Name" hint="What appears in the dropdown.">
                    <Input
                      value={o.label}
                      onChange={(e) => {
                        // Update both fields so it's clear they stay in sync.
                        update(i, 'label', e.target.value);
                        update(i, 'value', e.target.value);
                      }}
                      placeholder="e.g. Construction"
                      className="sm:col-span-2"
                    />
                  </Field>
                ) : (
                  <>
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
                  </>
                )}
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

  // --- Email transport test ---
  const [testingEmail, setTestingEmail] = useState(false);
  async function sendTestEmail() {
    setTestingEmail(true);
    try {
      const res = await fetch('/api/settings/email-test', { method: 'POST' });
      const j = await res.json();
      if (j.ok) {
        toast.success(`Test email sent via ${j.transport} to ${j.to}. Check your inbox.`);
      } else {
        toast.error(j.error || 'Email test failed.');
      }
    } catch {
      toast.error('Email test failed.');
    } finally {
      setTestingEmail(false);
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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Email delivery</CardTitle>
          <CardDescription>
            Password resets and verification codes are sent from your platform email account. Send a test to confirm it is working.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={sendTestEmail} loading={testingEmail}>
            Send test email to myself
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Sends a test message to your own login email. If it does not arrive, the email account needs configuring.
          </p>
        </CardContent>
      </Card>

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
    </div>
  );
}

/* ============================================================
   BACKUP & EXPORT — the easy, recommended path
   ============================================================ */
function BackupSection() {
  const [downloading, setDownloading] = useState(false);

  async function downloadSnapshot() {
    setDownloading(true);
    try {
      const res = await fetch('/api/settings/backup-export', { cache: 'no-store' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || 'Could not generate backup.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `cortada-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommended: download a full backup</CardTitle>
          <CardDescription>
            One click downloads a complete JSON snapshot of your CRM — every deal, funder, contact, submission, commission, payment, and accounting entry. Save it to your computer, Dropbox, or anywhere safe. If your CRM ever gets wiped, this file has everything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={downloadSnapshot} disabled={downloading}>
            {downloading ? 'Preparing your backup…' : 'Download backup now'}
          </Button>
          <div className="text-xs text-muted-foreground space-y-1 pt-2">
            <div>• Includes every record visible in the CRM, plus historical/audit data.</div>
            <div>• Excludes passwords and SMTP credentials (security).</div>
            <div>• Plain JSON — opens in any text editor, viewer, or import tool.</div>
            <div>• Recommended cadence: download once a week. Bookmark this page for one-click access.</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Already automatic: Point-in-Time Recovery</CardTitle>
          <CardDescription>
            Your database (Neon Postgres) automatically saves continuous restore points. If something gets accidentally deleted or corrupted, the database can be rolled back to any second within the last 7 days at no extra cost — even if you don&apos;t have a manual backup. Contact support to use this.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-page CSV exports</CardTitle>
          <CardDescription>
            For lighter, spreadsheet-friendly exports, click <strong>Export CSV</strong> on any list page (Funders, Submissions, Commissions, Payments, Accounting, Active Deals, Funded Board). Useful for pulling one specific dataset into Excel for analysis.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

/* ============================================================
   GOOGLE SHEETS BACKUP
   ============================================================ */
function SheetSyncSection() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<{
    configured: boolean; enabled: boolean; serviceAccountEmail: string | null;
    spreadsheetId: string | null; lastSyncAt: string | null; lastSyncStatus: string | null; lastSyncError: string | null;
  } | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [credentials, setCredentials] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [forcing, setForcing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/sheet-sync');
      const j = await res.json();
      setCfg(j);
      setSpreadsheetId(j.spreadsheetId ?? '');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save(enabledOverride?: boolean) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { spreadsheetId };
      if (credentials.trim()) body.credentials = credentials.trim();
      if (enabledOverride !== undefined) body.enabled = enabledOverride;
      const res = await fetch('/api/settings/sheet-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Save failed'); return; }
      toast.success('Saved.');
      setCredentials('');
      load();
    } finally { setSaving(false); }
  }

  async function runAction(action: 'test' | 'force') {
    const set = action === 'test' ? setTesting : setForcing;
    set(true);
    try {
      const res = await fetch('/api/settings/sheet-sync/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const j = await res.json();
      if (!j.ok) { toast.error(j.error || `${action} failed`); return; }
      if (action === 'test') toast.success(`Connected to "${j.title}". Tabs: ${j.tabs.join(', ') || 'none yet'}.`);
      else {
        const a = (j.appended ?? {}) as Record<string, number>;
        const total = Object.values(a).reduce((acc, n) => acc + (n as number), 0);
        const summary = Object.entries(a)
          .filter(([, c]) => (c as number) > 0)
          .map(([k, c]) => `${c} ${k}`)
          .join(', ');
        toast.success(total > 0 ? `Appended ${total} rows (${summary}).` : 'Sheet already up to date.');
        load();
      }
    } finally { set(false); }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const step1Done = !!cfg?.configured;
  const step2Done = !!cfg?.spreadsheetId;
  const step3Done = cfg?.lastSyncStatus === 'ok';

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Explainer: what this does, in plain language */}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900">
        <div className="font-semibold mb-1">How this works</div>
        <div className="text-[13px] leading-relaxed text-emerald-900/90">
          Once connected, every change you make in the CRM — new deals, funder edits, commission updates, payments, accounting entries — automatically appends a new row to your Google Sheet within seconds.
          The Sheet is <strong>append-only</strong>: rows are added, never removed or overwritten. If a record gets deleted from the CRM, the last known state stays in the Sheet forever. Each appended row has a &quot;Backed up at&quot; timestamp so you can see exactly when it was saved.
          You can stop using the CRM tomorrow and your Sheet would still have everything.
        </div>
      </div>

      {/* Live status bar — always visible at the top */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${cfg?.enabled && step3Done ? 'bg-emerald-500' : cfg?.enabled ? 'bg-amber-400' : 'bg-muted-foreground/40'}`} />
            <div>
              <div className="font-semibold text-sm">
                {cfg?.enabled && step3Done ? 'Backup is live' : cfg?.enabled ? 'Backup configured — waiting for first sync' : 'Backup is off'}
              </div>
              {cfg?.lastSyncAt && (
                <div className="text-[11px] text-muted-foreground">Last sync: {new Date(cfg.lastSyncAt).toLocaleString()}</div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {cfg?.configured && cfg?.spreadsheetId && (
              <Button size="sm" variant="outline" onClick={() => runAction('force')} loading={forcing}>
                Sync now
              </Button>
            )}
            <Button
              size="sm"
              variant={cfg?.enabled ? 'outline' : 'default'}
              onClick={() => save(!cfg?.enabled)}
              loading={saving}
              disabled={!step1Done || !step2Done}
            >
              {cfg?.enabled ? 'Pause backup' : 'Turn on backup'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {cfg?.lastSyncError && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          <strong>Last sync error:</strong> {cfg.lastSyncError}
        </div>
      )}

      {/* Step 1: Service account */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <StepBadge done={step1Done} number={1} />
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base">Connect Google</CardTitle>
              <CardDescription>One-time. Lets the platform write to your Sheet on your behalf.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!step1Done ? (
            <>
              <ol className="text-sm space-y-1.5 list-decimal pl-5 text-muted-foreground">
                <li>Open{' '}
                  <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer" className="underline text-foreground">
                    Google Cloud Console
                  </a>{' '}
                  and create a new project (any name).
                </li>
                <li>Search for &quot;Google Sheets API&quot; and click <strong>Enable</strong>.</li>
                <li>Go to <strong>IAM &amp; Admin → Service Accounts</strong>, click <strong>Create service account</strong>, give it any name, then skip the optional permission steps.</li>
                <li>On the new service account, open the <strong>Keys</strong> tab → <strong>Add Key → JSON</strong>. A file downloads.</li>
                <li>Open the downloaded JSON file in any text editor and paste the entire contents below.</li>
              </ol>
              <Field label="Paste the JSON key file contents">
                <Textarea rows={4} value={credentials} onChange={(e) => setCredentials(e.target.value)} placeholder='{ "type": "service_account", "client_email": "...", "private_key": "..." }' />
              </Field>
              <Button onClick={() => save()} loading={saving} disabled={!credentials.trim()}>
                Save credentials
              </Button>
            </>
          ) : (
            <div className="flex items-start gap-2 text-sm">
              <div className="flex-1">
                <div className="font-medium text-emerald-700">Connected ✓</div>
                <div className="text-xs text-muted-foreground mt-0.5">Service account:</div>
                <div className="font-mono text-xs break-all">{cfg.serviceAccountEmail}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setCredentials(''); }}>Replace</Button>
            </div>
          )}
          {step1Done && credentials.trim().length > 0 && (
            <>
              <Field label="Replace JSON key">
                <Textarea rows={4} value={credentials} onChange={(e) => setCredentials(e.target.value)} />
              </Field>
              <Button onClick={() => save()} loading={saving}>Update credentials</Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Sheet */}
      <Card className={!step1Done ? 'opacity-50 pointer-events-none' : ''}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <StepBadge done={step2Done} number={2} />
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base">Pick your backup Sheet</CardTitle>
              <CardDescription>Create one Google Sheet and paste its link or ID.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {cfg?.serviceAccountEmail && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2.5 text-amber-900">
              <strong>Important:</strong> Open your Google Sheet, click <strong>Share</strong>, and give <strong>Editor</strong> access to this email:
              <div className="font-mono font-semibold break-all mt-1.5 text-foreground">{cfg.serviceAccountEmail}</div>
            </div>
          )}
          <Field
            label="Google Sheet link or ID"
            hint='Paste the URL ("https://docs.google.com/spreadsheets/d/AbC123.../edit") OR just the ID part.'
          >
            <Input
              value={spreadsheetId}
              onChange={(e) => {
                // Accept full URL — auto-extract the ID
                const v = e.target.value;
                const m = v.match(/\/d\/([a-zA-Z0-9_-]+)/);
                setSpreadsheetId(m ? m[1] : v.trim());
              }}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => save()} loading={saving} disabled={!spreadsheetId.trim()}>
              {step2Done ? 'Update sheet' : 'Save sheet'}
            </Button>
            {step2Done && (
              <Button variant="outline" onClick={() => runAction('test')} loading={testing}>
                Test connection
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Turn it on */}
      <Card className={!step2Done ? 'opacity-50 pointer-events-none' : ''}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <StepBadge done={!!cfg?.enabled} number={3} />
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base">Turn on automatic backup</CardTitle>
              <CardDescription>Every change to your CRM syncs to the Sheet within seconds.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => save(!cfg?.enabled)}
            loading={saving}
            variant={cfg?.enabled ? 'outline' : 'default'}
          >
            {cfg?.enabled ? 'Pause automatic backup' : 'Turn on automatic backup'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StepBadge({ number, done }: { number: number; done: boolean }) {
  return (
    <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
      done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'
    }`}>
      {done ? '✓' : number}
    </div>
  );
}

/* ============================================================
   LEAD SOURCES
   ============================================================ */
interface LeadSourceItem {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
}

function LeadSourcesSection() {
  const toast = useToast();
  const [items, setItems] = useState<LeadSourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(Partial<LeadSourceItem> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/lead-sources');
      const j = await res.json();
      setItems(j.leadSources ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing?.name || !editing.name.trim()) { toast.error('Name is required.'); return; }
    setSaving(true);
    try {
      const body = {
        name: editing.name.trim(),
        contactEmail: editing.contactEmail || '',
        contactPhone: editing.contactPhone || '',
        notes: editing.notes || '',
        isActive: editing.isActive ?? true,
      };
      const res = editing.id
        ? await fetch(`/api/lead-sources/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/lead-sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Save failed'); return; }
      toast.success(editing.id ? 'Lead source updated.' : 'Lead source added.');
      setEditing(null);
      load();
    } finally { setSaving(false); }
  }

  async function remove(item: LeadSourceItem) {
    if (!confirm(`Delete "${item.name}"? (If it has commissions, deactivate it instead.)`)) return;
    const res = await fetch(`/api/lead-sources/${item.id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(j.error || 'Delete failed'); return; }
    toast.success('Deleted.');
    load();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Lead Sources</CardTitle>
            <CardDescription>
              Partners who refer deals. Create one here, then assign commissions on the Commissions page,
              and optionally create a restricted login under Users (role: Lead source).
            </CardDescription>
          </div>
          <Button onClick={() => setEditing({ name: '', isActive: true })}>+ Add lead source</Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">No lead sources yet. Click “+ Add lead source”.</div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {item.name}
                    {!item.isActive && <Badge variant="outline" className="text-[10px]">inactive</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[item.contactEmail, item.contactPhone].filter(Boolean).join(' · ') || 'No contact info'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(item)}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => remove(item)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {editing && (
        <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-base font-semibold">{editing.id ? 'Edit lead source' : 'New lead source'}</h2>
            </div>
            <div className="p-6 space-y-3">
              <Field label="Name" required><Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. ABC Referrals" /></Field>
              <Field label="Contact email"><Input value={editing.contactEmail ?? ''} onChange={(e) => setEditing({ ...editing, contactEmail: e.target.value })} /></Field>
              <Field label="Contact phone"><Input value={editing.contactPhone ?? ''} onChange={(e) => setEditing({ ...editing, contactPhone: e.target.value })} /></Field>
              <Field label="Notes"><Textarea rows={3} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.isActive ?? true} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
              <Button onClick={save} loading={saving}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ============================================================
   LOGO INPUT — file upload or URL paste
   ============================================================ */
function LogoInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'upload' | 'url'>(value && /^https?:\/\//i.test(value) ? 'url' : 'upload');
  const [uploading, setUploading] = useState(false);

  async function onFile(file: File) {
    if (file.size > 1_000_000) {
      toast.error('File is too large. Maximum 1MB.');
      return;
    }
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      toast.error('Unsupported file type. Use PNG, JPG, SVG, WebP, or GIF.');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Read failed'));
        r.readAsDataURL(file);
      });
      onChange(dataUrl);
    } catch {
      toast.error('Could not read file.');
    } finally { setUploading(false); }
  }

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-xs">
        {(['upload', 'url'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1 rounded font-medium transition ${mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {m === 'upload' ? 'Upload file' : 'Paste URL'}
          </button>
        ))}
      </div>

      {mode === 'upload' ? (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card hover:bg-muted text-sm font-medium transition">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            {uploading ? 'Reading…' : value ? 'Change image' : 'Choose image'}
          </label>
          {value && (
            <button type="button" onClick={() => onChange('')} className="text-xs text-muted-foreground hover:text-foreground">
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange('/brand/cortada-icon.png')}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Use bundled Cortada logo
          </button>
        </div>
      ) : (
        <Input
          value={/^data:/.test(value) ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com/logo.png"
        />
      )}

      {!value && (
        <div className="mt-2 flex items-center gap-3 px-3 py-2 rounded-md border border-dashed border-border bg-muted/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/cortada-icon.png"
            alt="Default Cortada logo"
            className="h-10 w-10 rounded-md object-contain bg-card border border-border"
          />
          <div className="text-xs text-muted-foreground">
            <div className="font-medium text-foreground">No custom logo</div>
            <div>Using the bundled Cortada logo by default.</div>
          </div>
        </div>
      )}

      {value && (
        <div className="mt-2 flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Logo preview"
            className="h-10 w-10 rounded-md object-contain bg-card border border-border"
            onError={(e) => {
              const el = e.currentTarget;
              el.style.opacity = '0.3';
              el.title = 'Image failed to load';
            }}
          />
          <div className="text-xs">
            <div className="font-medium">Preview</div>
            <div className="text-muted-foreground">
              {value.startsWith('data:') ? `Uploaded file (${Math.round(value.length / 1024)}KB encoded)` : 'External URL'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   FUNDED EMAIL TEMPLATE
   Admin defines subject + ordered list of fields. Reps use this
   to send funded notifications. Body stacks one field per line.
   ============================================================ */
interface FundedField { id?: string; label: string; hint?: string; type?: 'text' | 'date' }
interface FundedTemplate { subject: string; fields: FundedField[]; attachmentNote?: string | null }

function FundedTemplateSection() {
  const toast = useToast();
  const [tmpl, setTmpl] = useState<FundedTemplate>({ subject: '', fields: [], attachmentNote: '' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings/funded-email-template', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const d = j?.data ?? null;
        if (d && typeof d === 'object') {
          setTmpl({
            subject: d.subject ?? '',
            fields: Array.isArray(d.fields) ? d.fields : [],
            attachmentNote: d.attachmentNote ?? '',
          });
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  function updateField(i: number, k: 'label' | 'hint' | 'type', v: string) {
    const next = [...tmpl.fields];
    if (k === 'type') {
      next[i] = { ...next[i], type: (v === 'date' ? 'date' : 'text') };
    } else {
      next[i] = { ...next[i], [k]: v };
    }
    setTmpl({ ...tmpl, fields: next });
  }
  function addField() {
    setTmpl({ ...tmpl, fields: [...tmpl.fields, { label: '', hint: '' }] });
  }
  function removeField(i: number) {
    setTmpl({ ...tmpl, fields: tmpl.fields.filter((_, idx) => idx !== i) });
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= tmpl.fields.length) return;
    const next = [...tmpl.fields];
    [next[i], next[j]] = [next[j], next[i]];
    setTmpl({ ...tmpl, fields: next });
  }

  async function save() {
    setSaving(true);
    const res = await fetch('/api/settings/funded-email-template', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: tmpl.subject.trim(),
        fields: tmpl.fields.filter((f) => f.label.trim()).map((f) => ({
          id: f.id, label: f.label.trim(), hint: f.hint?.trim() || undefined,
          type: f.type ?? 'text',
        })),
        attachmentNote: tmpl.attachmentNote?.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success('Funded email template saved.');
  }

  if (!loaded) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-5 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject line</CardTitle>
          <CardDescription>
            Used as the email subject when a rep sends a funded notification. Reps see this exactly as you write it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field label="Subject">
            <Input
              value={tmpl.subject}
              onChange={(e) => setTmpl({ ...tmpl, subject: e.target.value })}
              placeholder="Funded — Merchant Name"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Information fields</CardTitle>
          <CardDescription>
            One per line in the order they appear in the email. Reps fill these in when sending; the body stacks them vertically as <span className="font-mono">Label: value</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {tmpl.fields.length === 0 && (
            <div className="text-xs text-muted-foreground">No fields yet. Add one below.</div>
          )}
          {tmpl.fields.map((f, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded border border-border bg-card">
              <div className="flex flex-col pt-2">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 text-xs">▲</button>
                <button onClick={() => move(i, 1)} disabled={i === tmpl.fields.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 text-xs">▼</button>
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="flex gap-2">
                  <Input
                    value={f.label}
                    onChange={(e) => updateField(i, 'label', e.target.value)}
                    placeholder="Label (e.g. Merchant Name, Funded Amount, Funded Date)"
                  />
                  {/* Type selector — controls whether the rep sees a date picker
                      or a text input. Date fields are formatted as "Jan 15, 2026"
                      in the email body. Defaults to Text. */}
                  <select
                    value={f.type ?? 'text'}
                    onChange={(e) => updateField(i, 'type', e.target.value as 'text' | 'date')}
                    className="h-10 rounded-md border border-input bg-card px-2 text-sm shrink-0"
                    title="Input type"
                  >
                    <option value="text">Text</option>
                    <option value="date">Date</option>
                  </select>
                </div>
                <Input
                  value={f.hint ?? ''}
                  onChange={(e) => updateField(i, 'hint', e.target.value)}
                  placeholder="Hint shown under the input (optional)"
                  className="text-xs"
                />
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeField(i)}>Delete</Button>
            </div>
          ))}
          <Button variant="outline" onClick={addField}>+ Add field</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attachments — recommendation note</CardTitle>
          <CardDescription>
            Shown next to the attach-files button on the funded-email page. Use it to remind reps what to upload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            value={tmpl.attachmentNote ?? ''}
            onChange={(e) => setTmpl({ ...tmpl, attachmentNote: e.target.value })}
            placeholder="e.g. Attach the signed contract, void check, and funding confirmation."
          />
        </CardContent>
      </Card>

      <div>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save template'}</Button>
      </div>
    </div>
  );
}

/* ============================================================
   SIDEBAR ORDER — categorized
   Admin defines sections (Workflow / Commissions / Resources or
   whatever they want), and assigns nav items to sections. Order
   syncs globally to every user in the company. New items added
   in future releases auto-bucket into "Other" until placed.
   ============================================================ */
import { ALL_NAV_ITEMS, DEFAULT_CATEGORIES } from '@/components/sidebar';
import { SIDEBAR_ICON_NAMES, resolveIcon } from '@/lib/sidebar-icons';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { triggerFundingCelebration } from '@/components/funding-celebration';

interface EditCategory { id: string; label: string; items: string[] }

/**
 * CelebrationSection — admin-only knobs that drive the funded-deal
 * celebration overlay shown app-wide when a deal status flips to 'funded'.
 *
 * Three controls + a live preview button:
 *   • celebrationEnabled — master switch
 *   • confettiEnabled    — toggle particles independently of the message
 *   • celebrationMessage — free text (default: "Fundeddddd!!!!")
 *
 * The preview button dispatches the same event the real funded flow uses,
 * but with `previewOverride` so the in-progress draft renders without
 * saving. Settings persist to /api/settings/company.
 */
function CelebrationSection() {
  const toast = useToast();
  const [celebrationEnabled, setCelebrationEnabled] = useState(true);
  const [confettiEnabled, setConfettiEnabled] = useState(true);
  const [celebrationSoundEnabled, setCelebrationSoundEnabled] = useState(false);
  const [celebrationMessage, setCelebrationMessage] = useState('Fundeddddd!!!!');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings/company')
      .then((r) => r.json())
      .then((j) => {
        const d = j.data ?? {};
        if (typeof d.celebrationEnabled === 'boolean') setCelebrationEnabled(d.celebrationEnabled);
        if (typeof d.confettiEnabled === 'boolean') setConfettiEnabled(d.confettiEnabled);
        if (typeof d.celebrationSoundEnabled === 'boolean') setCelebrationSoundEnabled(d.celebrationSoundEnabled);
        if (typeof d.celebrationMessage === 'string') setCelebrationMessage(d.celebrationMessage);
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
        celebrationEnabled,
        confettiEnabled,
        celebrationSoundEnabled,
        celebrationMessage: celebrationMessage.trim() || 'Fundeddddd!!!!',
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Save failed.');
      return;
    }
    toast.success('Celebration settings saved.');
  }

  function preview() {
    triggerFundingCelebration({
      dealName: 'Acme Pizza (preview)',
      previewOverride: {
        celebrationEnabled: true,
        confettiEnabled,
        celebrationSoundEnabled,
        celebrationMessage: celebrationMessage.trim() || 'Fundeddddd!!!!',
      },
    });
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Funded celebration</CardTitle>
          <CardDescription>
            Show a confetti animation + custom message when any deal in your
            company is marked Funded. Every user sees the same celebration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={celebrationEnabled}
              onChange={(e) => setCelebrationEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium">Show a celebration when a deal funds</span>
          </label>

          <label className={cn('flex items-center gap-2 cursor-pointer', !celebrationEnabled && 'opacity-50')}>
            <input
              type="checkbox"
              checked={confettiEnabled}
              onChange={(e) => setConfettiEnabled(e.target.checked)}
              disabled={!celebrationEnabled}
              className="h-4 w-4"
            />
            <span className="text-sm">Include confetti animation</span>
          </label>

          {/* Optional gong sound — off by default. The gong is synthesized
              inline (no audio asset to ship): 110Hz fundamental + four
              inharmonic partials decaying over ~2.4s for the
              characteristic bronze resonance. Use sparingly in shared
              workspaces. The Preview button below plays the full
              celebration (animation + sound if enabled) so the user can
              audition the sound before saving. */}
          <label className={cn('flex items-center gap-2 cursor-pointer', !celebrationEnabled && 'opacity-50')}>
            <input
              type="checkbox"
              checked={celebrationSoundEnabled}
              onChange={(e) => setCelebrationSoundEnabled(e.target.checked)}
              disabled={!celebrationEnabled}
              className="h-4 w-4"
            />
            <span className="text-sm">Play gong sound on funded deal</span>
          </label>

          <Field label="Celebration message">
            <Input
              value={celebrationMessage}
              onChange={(e) => setCelebrationMessage(e.target.value)}
              disabled={!celebrationEnabled}
              placeholder="Fundeddddd!!!!"
              maxLength={200}
            />
          </Field>
          <div className="text-[11px] text-muted-foreground -mt-2">
            Shown as a big colorful banner. Max 200 characters. Empty falls
            back to "Fundeddddd!!!!".
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Button variant="outline" onClick={preview}>Preview</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SidebarOrderSection() {
  const toast = useToast();
  // Editable categories — initial state filled from the saved config or
  // default. Each category has a stable id, a label, and a list of nav
  // item hrefs in order. Items not in any category get placed into the
  // last category via the "Add item" picker; that's the only way the
  // admin physically adds an item to the sidebar.
  const [cats, setCats] = useState<EditCategory[]>(
    DEFAULT_CATEGORIES.map((c) => ({ ...c, items: [...c.items] }))
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  // For the per-category "Add item" picker — which category is open + which
  // item is currently selected in its dropdown.
  const [pickerOpen, setPickerOpen] = useState<string | null>(null);
  // Per-item label/icon overrides (admin-controlled, sync globally). Keyed
  // by href. Null fields = use the item's hardcoded default.
  const [overrides, setOverrides] = useState<Record<string, { label?: string; icon?: string }>>({});
  // Which item's inline editor is open. Stores the href. Null = closed.
  const [editingItem, setEditingItem] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/sidebar-order', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        // Priority: saved categories → saved flat order → default categories.
        const savedCats = j?.data?.categories as EditCategory[] | null;
        const savedOrder = j?.data?.order as string[] | null;
        const savedOv = j?.data?.itemOverrides as Record<string, { label?: string; icon?: string }> | null;
        if (Array.isArray(savedCats) && savedCats.length) {
          setCats(savedCats.map((c) => ({
            id: c.id, label: c.label, items: [...(c.items ?? [])],
          })));
        } else if (Array.isArray(savedOrder) && savedOrder.length) {
          // Legacy flat-order tenants: bring everything into a single
          // editable section the admin can split apart.
          setCats([{ id: 'menu', label: 'Menu', items: [...savedOrder] }]);
        }
        if (savedOv && typeof savedOv === 'object') setOverrides(savedOv);
      })
      .finally(() => setLoaded(true));
  }, []);

  // Helper: update one item's override. Empty values clear that field; if
  // both label and icon end up empty, the entire override entry is removed
  // so we don't persist no-op rows.
  function setItemOverride(href: string, patch: { label?: string; icon?: string }) {
    setOverrides((prev) => {
      const next = { ...prev };
      const current = next[href] ?? {};
      const merged = { ...current, ...patch };
      if (!merged.label && !merged.icon) {
        delete next[href];
      } else {
        next[href] = merged;
      }
      return next;
    });
  }

  // Set of hrefs already placed in some category. Used to figure out which
  // items are still available to add to a category.
  const placedHrefs = new Set(cats.flatMap((c) => c.items));
  const unplaced = ALL_NAV_ITEMS.filter((i) => !placedHrefs.has(i.href));

  // ---- Category-level edits ---------------------------------------------
  function addCategory() {
    const id = `cat_${Math.random().toString(36).slice(2, 8)}`;
    setCats([...cats, { id, label: 'New section', items: [] }]);
  }
  function removeCategory(idx: number) {
    if (cats.length === 1) {
      toast.error('Keep at least one section.');
      return;
    }
    if (!confirm(`Delete "${cats[idx].label}"? Its items become Unassigned and will appear under "Other" until you move them.`)) return;
    setCats(cats.filter((_, i) => i !== idx));
  }
  function renameCategory(idx: number, label: string) {
    const next = [...cats];
    next[idx] = { ...next[idx], label };
    setCats(next);
  }
  function moveCategory(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= cats.length) return;
    const next = [...cats];
    [next[idx], next[j]] = [next[j], next[idx]];
    setCats(next);
  }

  // ---- Item-level edits -------------------------------------------------
  function moveItem(catIdx: number, itemIdx: number, dir: -1 | 1) {
    const j = itemIdx + dir;
    const cat = cats[catIdx];
    if (j < 0 || j >= cat.items.length) return;
    const items = [...cat.items];
    [items[itemIdx], items[j]] = [items[j], items[itemIdx]];
    const next = [...cats];
    next[catIdx] = { ...cat, items };
    setCats(next);
  }
  function removeItem(catIdx: number, itemIdx: number) {
    const cat = cats[catIdx];
    const items = cat.items.filter((_, i) => i !== itemIdx);
    const next = [...cats];
    next[catIdx] = { ...cat, items };
    setCats(next);
  }
  function moveItemToCategory(catIdx: number, itemIdx: number, targetCatId: string) {
    if (cats[catIdx].id === targetCatId) return;
    const href = cats[catIdx].items[itemIdx];
    const next = cats.map((c) => {
      if (c.id === cats[catIdx].id) return { ...c, items: c.items.filter((_, i) => i !== itemIdx) };
      if (c.id === targetCatId) return { ...c, items: [...c.items, href] };
      return c;
    });
    setCats(next);
  }
  function addItemToCategory(catIdx: number, href: string) {
    // Defensive: remove from anywhere it already exists, then append.
    const next = cats.map((c) => ({ ...c, items: c.items.filter((h) => h !== href) }));
    next[catIdx] = { ...next[catIdx], items: [...next[catIdx].items, href] };
    setCats(next);
    setPickerOpen(null);
  }

  // ---- Save / reset -----------------------------------------------------
  async function save() {
    setSaving(true);
    const payload = cats.map((c) => ({
      id: c.id,
      label: c.label.trim() || 'Section',
      items: c.items,
    }));
    // Strip empty/no-op overrides before sending.
    const trimmedOverrides: Record<string, { label?: string; icon?: string }> = {};
    for (const [href, ov] of Object.entries(overrides)) {
      const label = ov.label?.trim();
      const icon = ov.icon?.trim();
      if (!label && !icon) continue;
      trimmedOverrides[href] = {};
      if (label) trimmedOverrides[href].label = label;
      if (icon) trimmedOverrides[href].icon = icon;
    }
    const res = await fetch('/api/settings/sidebar-order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: payload,
        order: null,
        itemOverrides: Object.keys(trimmedOverrides).length > 0 ? trimmedOverrides : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not save.');
      return;
    }
    toast.success('Saved. Refresh to see the new sidebar.');
  }
  async function resetToDefault() {
    if (!confirm('Reset the sidebar to the default sections + names for everyone in your company?')) return;
    setResetting(true);
    const res = await fetch('/api/settings/sidebar-order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: null, order: null, itemOverrides: null }),
    });
    setResetting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not reset.');
      return;
    }
    setCats(DEFAULT_CATEGORIES.map((c) => ({ ...c, items: [...c.items] })));
    setOverrides({});
    toast.success('Reset to default. Refresh to see the change.');
  }

  if (!loaded) return <div className="text-sm text-muted-foreground">Loading…</div>;

  // Lookup for icons / labels on each item by href.
  const itemByHref = new Map(ALL_NAV_ITEMS.map((i) => [i.href, i]));

  return (
    <div className="space-y-5 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sidebar sections</CardTitle>
          <CardDescription>
            Group menu items into categories. The order and the names you set apply company-wide — every user (admins and reps) sees the same sidebar. Each user only sees the items their permissions allow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {cats.map((cat, catIdx) => (
            <div key={cat.id} className="rounded-lg border border-border bg-card">
              {/* Section header: rename + reorder + delete the whole category */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 rounded-t-lg">
                <div className="flex flex-col">
                  <button
                    onClick={() => moveCategory(catIdx, -1)}
                    disabled={catIdx === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 leading-none text-xs"
                    title="Move section up"
                  >▲</button>
                  <button
                    onClick={() => moveCategory(catIdx, 1)}
                    disabled={catIdx === cats.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 leading-none text-xs"
                    title="Move section down"
                  >▼</button>
                </div>
                <Input
                  value={cat.label}
                  onChange={(e) => renameCategory(catIdx, e.target.value)}
                  placeholder="Section name"
                  className="h-8 text-sm font-medium flex-1"
                />
                <Button variant="ghost" size="sm" onClick={() => removeCategory(catIdx)} title="Delete section">
                  Delete
                </Button>
              </div>

              {/* Items inside this section */}
              <div className="p-2 space-y-1.5">
                {cat.items.length === 0 && (
                  <div className="text-xs text-muted-foreground px-2 py-1">No items yet — add some below.</div>
                )}
                {cat.items.map((href, itemIdx) => {
                  const item = itemByHref.get(href);
                  if (!item) {
                    // Item was removed from the app — render a stub with a remove button.
                    return (
                      <div key={href} className="flex items-center gap-2 p-1.5 rounded border border-dashed border-border text-xs text-muted-foreground">
                        <span className="flex-1 font-mono">{href} (no longer available)</span>
                        <button onClick={() => removeItem(catIdx, itemIdx)} className="hover:text-destructive">✕</button>
                      </div>
                    );
                  }
                  // Apply any saved override so the editor shows the actual
                  // sidebar label/icon (matching what users will see).
                  const ov = overrides[href] ?? {};
                  const displayLabel = ov.label || item.label;
                  const DisplayIcon = resolveIcon(ov.icon, item.icon as Parameters<typeof resolveIcon>[1]);
                  const isEditing = editingItem === href;
                  const isCustomized = !!(ov.label || ov.icon);
                  return (
                    <div key={href} className="rounded border border-border">
                      <div className="flex items-center gap-2 p-1.5">
                        <div className="flex flex-col">
                          <button
                            onClick={() => moveItem(catIdx, itemIdx, -1)}
                            disabled={itemIdx === 0}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 leading-none text-xs"
                            title="Move up"
                          >▲</button>
                          <button
                            onClick={() => moveItem(catIdx, itemIdx, 1)}
                            disabled={itemIdx === cat.items.length - 1}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-20 px-1 leading-none text-xs"
                            title="Move down"
                          >▼</button>
                        </div>
                        <DisplayIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="text-sm font-medium flex-1 min-w-0 truncate flex items-center gap-1.5">
                          {displayLabel}
                          {isCustomized && (
                            <span className="text-[9px] uppercase font-semibold text-primary bg-primary/10 px-1 rounded">
                              custom
                            </span>
                          )}
                        </div>
                        {/* Edit (rename + change icon) — opens an inline editor */}
                        <button
                          onClick={() => setEditingItem(isEditing ? null : href)}
                          title="Rename or change icon"
                          className={cn(
                            'h-6 px-1.5 rounded text-xs',
                            isEditing ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                          )}
                        >
                          ✎
                        </button>
                        {/* Move to other section */}
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) moveItemToCategory(catIdx, itemIdx, e.target.value);
                          }}
                          className="h-7 rounded border border-input bg-card px-1 text-xs text-muted-foreground"
                          title="Move to another section"
                        >
                          <option value="">Move to…</option>
                          {cats.filter((c) => c.id !== cat.id).map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeItem(catIdx, itemIdx)}
                          title="Remove from sidebar"
                          className="text-muted-foreground hover:text-destructive px-1 text-sm"
                        >✕</button>
                      </div>
                      {/* Inline editor — label input + icon picker. Empty
                          label = revert to the item's default name. Same
                          for empty icon. */}
                      {isEditing && (
                        <div className="border-t border-border bg-muted/20 p-2 space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                Rename ({item.label} by default)
                              </div>
                              <input
                                type="text"
                                value={ov.label ?? ''}
                                onChange={(e) => setItemOverride(href, { label: e.target.value })}
                                placeholder={item.label}
                                maxLength={40}
                                className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm"
                              />
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                Icon
                              </div>
                              <select
                                value={ov.icon ?? ''}
                                onChange={(e) => setItemOverride(href, { icon: e.target.value })}
                                className="h-8 rounded-md border border-input bg-card px-2 text-sm min-w-[140px]"
                              >
                                <option value="">— default —</option>
                                {SIDEBAR_ICON_NAMES.map((n) => (
                                  <option key={n} value={n}>{n}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {/* Icon preview grid — visual confirmation. */}
                          <div className="flex flex-wrap gap-1 pt-1">
                            {SIDEBAR_ICON_NAMES.map((n) => {
                              const I = resolveIcon(n, item.icon as Parameters<typeof resolveIcon>[1]);
                              const isPicked = (ov.icon ?? '') === n;
                              return (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => setItemOverride(href, { icon: n })}
                                  title={n}
                                  className={cn(
                                    'h-7 w-7 rounded flex items-center justify-center transition-colors',
                                    isPicked
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-card border border-border text-muted-foreground hover:bg-muted'
                                  )}
                                >
                                  <I className="h-4 w-4" />
                                </button>
                              );
                            })}
                          </div>
                          {isCustomized && (
                            <button
                              onClick={() => {
                                setItemOverride(href, { label: undefined, icon: undefined });
                                setOverrides((prev) => {
                                  const next = { ...prev };
                                  delete next[href];
                                  return next;
                                });
                              }}
                              className="text-[11px] text-muted-foreground hover:text-destructive"
                            >
                              Reset this tab to defaults
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add-item picker — pulls from items not yet in ANY category */}
                {pickerOpen === cat.id ? (
                  <div className="flex items-center gap-2 p-1.5 rounded border border-dashed border-border">
                    <select
                      autoFocus
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) addItemToCategory(catIdx, e.target.value);
                      }}
                      className="h-8 rounded border border-input bg-card px-2 text-sm flex-1"
                    >
                      <option value="">Pick an item to add…</option>
                      {unplaced.map((it) => (
                        <option key={it.href} value={it.href}>{it.label}</option>
                      ))}
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => setPickerOpen(null)}>Cancel</Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPickerOpen(cat.id)}
                    disabled={unplaced.length === 0}
                    className="w-full mt-1"
                  >
                    + Add item to this section
                  </Button>
                )}
              </div>
            </div>
          ))}

          <Button variant="outline" onClick={addCategory} className="w-full">
            + Add a new section
          </Button>

          {/* Show what items are not in any section yet, so the admin sees them. */}
          {unplaced.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-900">
              <div className="font-semibold mb-1">Not yet placed in a section:</div>
              <div>{unplaced.map((i) => i.label).join(', ')}</div>
              <div className="text-amber-800/80 mt-1">These will show under &quot;Other&quot; in the sidebar until you assign them to a section.</div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button variant="outline" onClick={resetToDefault} disabled={resetting}>
          {resetting ? 'Resetting…' : 'Reset to default'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Users need to refresh to see the change.
        </span>
      </div>
    </div>
  );
}
