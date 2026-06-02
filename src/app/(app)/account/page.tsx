'use client';

/**
 * /account — the PERSONAL settings page available to every user.
 *
 * Critical privacy boundary: this page MUST NEVER show anything that belongs
 * to the company at large — no lead sources, no other users, no commission
 * rules, no shared SMTP credentials, no Google Sheets config, no tier rules,
 * no branding. Just:
 *
 *   1. Change own password
 *   2. Configure own SMTP (only when emailMode === 'per_rep'; in shared mode
 *      the admin owns the credentials and the rep has nothing to set)
 *
 * Any other tab here would defeat the point — this is the SAFE page reps land
 * on when they click "configure SMTP" from the submit screen.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Card, CardHeader, CardTitle, CardContent, CardDescription,
  Button, Input, Textarea, Field, PageHeader,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { Mail, KeyRound, ShieldCheck, PenLine } from 'lucide-react';

interface MeUser { id: string; name: string; email: string; role: string }

export default function AccountPage() {
  const [me, setMe] = useState<MeUser | null>(null);
  const [emailMode, setEmailMode] = useState<'shared' | 'per_rep'>('shared');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/settings/company', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ]).then(([meRes, companyRes]) => {
      setMe(meRes?.user ?? null);
      const mode = companyRes?.data?.emailMode ?? companyRes?.emailMode;
      if (mode === 'shared' || mode === 'per_rep') setEmailMode(mode);
      setLoaded(true);
    });
  }, []);

  if (!loaded) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My account"
        description="Your personal settings. To change company-wide options, contact your admin."
      />

      {me && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Signed in as
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">{me.name}</div>
            <div className="text-xs text-muted-foreground font-mono">{me.email}</div>
            <div className="text-[11px] text-muted-foreground mt-1">Role: {me.role}</div>
          </CardContent>
        </Card>
      )}

      <ChangePasswordCard />

      <AlwaysCcCard />

      <SignatureCard />

      {emailMode === 'per_rep' ? (
        <MySmtpCard />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4" /> Email sending
            </CardTitle>
            <CardDescription>
              Your company uses a shared email account for outgoing deal submissions, configured by your admin. You don&apos;t need to set anything here.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

/* ============================================================
   Password change — uses the existing /api/users/me/password
   endpoint with 2-step email verification (same flow used in
   the admin settings page).
   ============================================================ */
function ChangePasswordCard() {
  const toast = useToast();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [step, setStep] = useState<'fill' | 'verifying' | 'codeSent'>('fill');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    if (!oldPw || !newPw) { toast.error('Fill in both password fields.'); return; }
    if (newPw !== confirmPw) { toast.error('New passwords don\'t match.'); return; }
    if (newPw.length < 8) { toast.error('Password must be at least 8 characters.'); return; }
    setBusy(true);
    const res = await fetch('/api/account/password/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: oldPw, newPassword: newPw }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not verify current password.');
      return;
    }
    toast.success('Verification code sent to your email.');
    setStep('codeSent');
  }

  async function confirmChange() {
    if (!code.trim()) { toast.error('Enter the code from your email.'); return; }
    setBusy(true);
    const res = await fetch('/api/account/password/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not change password.');
      return;
    }
    toast.success('Password updated.');
    setOldPw(''); setNewPw(''); setConfirmPw(''); setCode(''); setStep('fill');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Change password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Current password">
          <Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} disabled={step === 'codeSent'} />
        </Field>
        <Field label="New password">
          <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} disabled={step === 'codeSent'} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} disabled={step === 'codeSent'} />
        </Field>

        {step === 'codeSent' && (
          <Field label="Verification code (check your email)">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" />
          </Field>
        )}

        <div className="flex gap-2 pt-1">
          {step === 'fill' ? (
            <Button onClick={requestCode} disabled={busy}>
              {busy ? 'Sending code…' : 'Continue'}
            </Button>
          ) : (
            <>
              <Button onClick={confirmChange} disabled={busy}>
                {busy ? 'Updating…' : 'Confirm & change password'}
              </Button>
              <Button variant="outline" onClick={() => { setStep('fill'); setCode(''); }}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   Personal SMTP — only shown when emailMode === 'per_rep'.
   Uses the same /api/settings/smtp endpoint, which scopes
   reads/writes to the user's own user row automatically.
   ============================================================ */
function MySmtpCard() {
  const toast = useToast();
  const [host, setHost] = useState('smtp.gmail.com');
  const [port, setPort] = useState('587');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState('');
  const [hasConfig, setHasConfig] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/smtp', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      const d = j?.data ?? j;
      if (d?.hasConfig) {
        setHost(d.host ?? 'smtp.gmail.com');
        setPort(String(d.port ?? 587));
        setUser(d.user ?? '');
        setFrom(d.from ?? '');
        setHasConfig(true);
      }
    });
  }, []);

  async function verifyAndSave() {
    setVerifying(true);
    setVerifyMsg(null);
    const res = await fetch('/api/settings/smtp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port: parseInt(port, 10), user, pass, from, persistOnSuccess: true }),
    });
    const j = await res.json();
    setVerifying(false);
    if (j.success) {
      setVerifyMsg(j.saved ? '✓ Connection verified and saved. You can now send deals.' : '✓ Connection verified.');
      if (j.saved) { setPass(''); setHasConfig(true); }
    } else {
      setVerifyMsg(`✗ ${j.error || 'Verification failed'}`);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> My email SMTP
        </CardTitle>
        <CardDescription>
          Set up your personal email account so deals go out from your address. Your credentials are private — only you can see or edit them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP host"><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" /></Field>
          <Field label="Port"><Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" /></Field>
        </div>
        <Field label="Username (your email)"><Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="you@example.com" /></Field>
        <Field label={hasConfig ? 'New app password (leave blank to keep)' : 'App password'}>
          <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="16-character Gmail App Password" />
        </Field>
        <Field label="From address"><Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={user || 'you@example.com'} /></Field>

        <div className="pt-1">
          <Button onClick={verifyAndSave} disabled={verifying || !host || !user || !pass}>
            {verifying ? 'Verifying & saving…' : 'Verify & save'}
          </Button>
        </div>

        {verifyMsg && (
          <div className={`text-sm ${verifyMsg.startsWith('✓') ? 'text-emerald-700' : 'text-rose-700'}`}>{verifyMsg}</div>
        )}

        <p className="text-xs text-muted-foreground mt-3">
          <strong>Click <em>Verify &amp; save</em> once.</strong> That single click both checks the credentials with the server AND stores them.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          For Gmail/Workspace, use a 16-character <a className="underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">App Password</a> (NOT your regular password). 2-Step Verification must be on first.
        </p>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   Always CC — adds a fixed CC address to every deal email
   this rep sends. Stored on the rep's own user row so each
   user has their own preference. Empty clears the setting.
   ============================================================ */
function AlwaysCcCard() {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/account/cc', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const v = j?.data?.alwaysCcEmail ?? '';
        setValue(v);
        setSaved(v || null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    const res = await fetch('/api/account/cc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alwaysCcEmail: value.trim() }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(j.error || 'Could not save.');
      return;
    }
    const newVal = j?.data?.alwaysCcEmail ?? null;
    setSaved(newVal);
    setValue(newVal ?? '');
    toast.success(newVal ? 'Always CC saved.' : 'Always CC cleared.');
  }

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Always CC
        </CardTitle>
        <CardDescription>
          Automatically add this email address as CC on every deal you submit. Useful if you want your manager copied on outgoing submissions. Leave blank to turn off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="CC email">
          <Input
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="manager@company.com"
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || value.trim() === (saved ?? '')}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {saved && (
            <span className="text-xs text-muted-foreground">
              Currently CCing: <span className="font-mono">{saved}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
   Email signature — appended to every email this rep sends.
   Plain text, multi-line. Each rep manages their own.
   ============================================================ */
function SignatureCard() {
  const toast = useToast();
  const [text, setText] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [link, setLink] = useState('');
  const [savedText, setSavedText] = useState('');
  const [savedLogo, setSavedLogo] = useState('');
  const [savedLink, setSavedLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch('/api/account/signature', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const t = j?.data?.emailSignature ?? '';
        const l = j?.data?.signatureLogoUrl ?? '';
        const k = j?.data?.signatureLink ?? '';
        setText(t); setSavedText(t);
        setLogoUrl(l); setSavedLogo(l);
        setLink(k); setSavedLink(k);
      })
      .finally(() => setLoading(false));
  }, []);

  function onLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    // Reject SVG explicitly even though the OS file picker may show it.
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) {
      toast.error('Use PNG, JPG, WebP, or GIF (no SVG).');
      return;
    }
    if (f.size > 500 * 1024) {
      toast.error('Logo too large — keep it under 500 KB so emails don\'t get blocked.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setLogoUrl(String(reader.result)); };
    reader.onerror = () => { toast.error('Could not read the file.'); };
    reader.readAsDataURL(f);
  }

  async function save() {
    // Validate link is http(s) if provided
    if (link.trim() && !/^https?:\/\//i.test(link.trim())) {
      toast.error('Link must start with http:// or https://');
      return;
    }
    setSaving(true);
    const res = await fetch('/api/account/signature', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailSignature: text,
        signatureLogoUrl: logoUrl,
        signatureLink: link.trim(),
      }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(j.error || 'Could not save.');
      return;
    }
    setSavedText(j?.data?.emailSignature ?? '');
    setSavedLogo(j?.data?.signatureLogoUrl ?? '');
    setSavedLink(j?.data?.signatureLink ?? '');
    toast.success('Signature saved.');
  }

  const isDirty = text !== savedText || logoUrl !== savedLogo || link !== savedLink;

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PenLine className="h-4 w-4" /> Email signature
        </CardTitle>
        <CardDescription>
          Appears at the bottom of every email you send — deal submissions and funded notifications. The text version goes to plain-text inboxes, the logo and link to HTML inboxes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Signature text" hint="Your name, title, phone, and email. Multiple lines OK.">
          <Textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Best,\nYour Name\nDirect: (555) 555-5555\nyour@email.com'}
          />
        </Field>

        <Field label="Logo (optional)" hint="PNG, JPG, WebP, or GIF — under 500 KB. Appears below your text in HTML inboxes.">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Button variant="outline" type="button" onClick={() => fileRef.current?.click()}>
                {logoUrl ? 'Replace logo' : 'Upload logo'}
              </Button>
              {logoUrl && (
                <Button variant="ghost" type="button" onClick={() => setLogoUrl('')}>
                  Remove
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onLogoFileChange}
                className="hidden"
              />
            </div>
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Signature logo preview"
                className="block max-h-20 max-w-[260px] rounded border border-border bg-white p-1"
              />
            )}
          </div>
        </Field>

        <Field label="Link (optional)" hint="A URL the logo will link to. If no logo is set, the link still appears as a clickable line.">
          <Input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://yourcompany.com"
          />
        </Field>

        <div>
          <Button onClick={save} disabled={saving || !isDirty}>
            {saving ? 'Saving…' : 'Save signature'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
