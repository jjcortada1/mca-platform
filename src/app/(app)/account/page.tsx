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

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Card, CardHeader, CardTitle, CardContent, CardDescription,
  Button, Input, Field, PageHeader,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { Mail, KeyRound, ShieldCheck, Shield, PenLine, X } from 'lucide-react';

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

      <TwoFactorAuthCard />

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
   Two-Factor Authentication — email-based OTP for login
   ============================================================ */
function TwoFactorAuthCard() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        setEnabled(j?.user?.twoFactorEnabled ?? false);
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggle() {
    setSaving(true);
    const res = await fetch('/api/auth/toggle-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !enabled }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || 'Could not update 2FA settings.');
      return;
    }
    setEnabled(!enabled);
    toast.success(!enabled ? '2FA enabled. You\'ll need to enter a code from your email on next login.' : '2FA disabled.');
  }

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4" /> Two-factor authentication
        </CardTitle>
        <CardDescription>
          Require a verification code sent to your email when signing in. This adds extra security to your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{enabled ? 'Enabled' : 'Disabled'}</p>
            <p className="text-xs text-muted-foreground">
              {enabled
                ? 'You will receive a verification code via email when you sign in.'
                : 'Add an extra layer of security to your account.'}
            </p>
          </div>
          <Button
            onClick={toggle}
            disabled={saving}
            variant={enabled ? 'outline' : 'default'}
          >
            {saving ? 'Updating…' : enabled ? 'Disable 2FA' : 'Enable 2FA'}
          </Button>
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
const CC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parse a stored/typed value into a clean, deduped list of emails. */
function parseCcList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? '').split(/[,;\n]/)) {
    const e = part.trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function AlwaysCcCard() {
  const toast = useToast();
  // The list of confirmed chips + whatever's being typed in the input.
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/account/cc', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const list = parseCcList(j?.data?.alwaysCcEmail ?? '');
        setEmails(list);
        setSaved(list);
      })
      .finally(() => setLoading(false));
  }, []);

  // Commit the current draft as one or more chips. Returns false if any part
  // was an invalid email (so we can keep it in the box for correction).
  function commitDraft(): boolean {
    const parts = parseCcList(draft);
    if (!parts.length) { setDraft(''); return true; }
    const bad = parts.find((e) => !CC_EMAIL_RE.test(e));
    if (bad) { toast.error(`Not a valid email: ${bad}`); return false; }
    setEmails((prev) => {
      const merged = [...prev];
      for (const e of parts) if (!merged.includes(e)) merged.push(e);
      return merged;
    });
    setDraft('');
    return true;
  }

  function removeEmail(e: string) {
    setEmails((prev) => prev.filter((x) => x !== e));
  }

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commitDraft();
    } else if (ev.key === 'Backspace' && !draft && emails.length) {
      // Backspace on an empty box pops the last chip for quick editing.
      setEmails((prev) => prev.slice(0, -1));
    }
  }

  const dirty = useMemo(() => {
    const pending = draft.trim() ? [...emails, ...parseCcList(draft)] : emails;
    return pending.join(', ') !== saved.join(', ');
  }, [emails, draft, saved]);

  async function save() {
    // Fold any half-typed address into the list before saving.
    if (draft.trim() && !commitDraft()) return;
    const list = draft.trim()
      ? Array.from(new Set([...emails, ...parseCcList(draft)]))
      : emails;
    setSaving(true);
    const res = await fetch('/api/account/cc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alwaysCcEmail: list }),
    });
    const j = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast.error(j.error || 'Could not save.');
      return;
    }
    const newList = parseCcList(j?.data?.alwaysCcEmail ?? '');
    setSaved(newList);
    setEmails(newList);
    setDraft('');
    toast.success(newList.length ? 'Always CC saved.' : 'Always CC cleared.');
  }

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Always CC
        </CardTitle>
        <CardDescription>
          Automatically CC these addresses on every deal you submit. Add as many as you like — useful if you want your manager (or more than one person) copied on outgoing submissions. Leave empty to turn off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="CC emails">
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
            {emails.map((e) => (
              <span
                key={e}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-medium"
              >
                <span className="font-mono">{e}</span>
                <button
                  type="button"
                  onClick={() => removeEmail(e)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${e}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={emails.length ? 'Add another…' : 'manager@company.com'}
              className="min-w-[12ch] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => commitDraft()}
              disabled={!draft.trim().includes('@')}
              aria-label="Add CC email"
              title="Add this email"
              className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md border border-input bg-card text-base font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              +
            </button>
          </div>
        </Field>
        <p className="text-xs text-muted-foreground">
          Type an email and press + (or Enter) to add it.
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {saved.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Currently CCing {saved.length} {saved.length === 1 ? 'address' : 'addresses'}.
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
  const [testing, setTesting] = useState(false);
  // Rich editor surface. contentEditable keeps whatever the user pastes —
  // fonts, colors, images, layout — exactly as Gmail renders it. What you
  // see in the box is what recipients get.
  const editorRef = useRef<HTMLDivElement | null>(null);

  /** Load a stored signature into the editor. Plain-text legacy signatures
   *  get their newlines converted to <br> so they display correctly. */
  function setEditorContent(stored: string) {
    const el = editorRef.current;
    if (!el) return;
    if (/<[a-z][^>]*>/i.test(stored)) {
      el.innerHTML = stored;
    } else {
      el.textContent = '';
      el.innerHTML = stored
        .split('\n')
        .map((line) => line
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .join('<br>');
    }
  }

  /** Read the editor back out. An "empty" contentEditable often contains
   *  a stray <br> or empty div — normalize that to ''. */
  function readEditor(): string {
    const el = editorRef.current;
    if (!el) return '';
    const html = el.innerHTML.trim();
    const textOnly = (el.textContent ?? '').trim();
    const hasImage = /<img\b/i.test(html);
    if (!textOnly && !hasImage) return '';
    return html;
  }

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

  // Inject the SAVED signature into the editor once it's actually mounted.
  // The editor renders only after loading flips false, so a setTimeout from
  // the fetch callback could fire before the ref existed — which left the
  // box empty even though a signature was saved. This effect runs after the
  // post-loading render, when the ref is guaranteed to be there.
  useEffect(() => {
    if (!loading && savedText) setEditorContent(savedText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  /** Email yourself a sample message so you can verify exactly how the
   *  saved signature renders in a real inbox. */
  async function sendTest() {
    setTesting(true);
    const res = await fetch('/api/account/signature/test', { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    setTesting(false);
    if (!res.ok) {
      toast.error(j.error || 'Could not send the test email.');
      return;
    }
    toast.success(`Test email sent to ${j.to} — check your inbox.`);
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
        emailSignature: readEditor(),
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
    setText(j?.data?.emailSignature ?? '');
    toast.success('Signature saved.');
  }

  function clearSignature() {
    if (editorRef.current) editorRef.current.innerHTML = '';
    setText('');
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
          One signature, used on every email you send (deal submissions and funded notifications).
          Copy your signature in Gmail (Ctrl/Cmd-A in the signature box, then copy) and paste it below —
          fonts, colors, and images come through exactly as they look there.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Signature" hint="Paste from Gmail or type directly. What you see here is what recipients see.">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={() => setText(readEditor())}
            data-placeholder={'Best,\nYour Name\nDirect: (555) 555-5555'}
            className="min-h-[120px] w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-muted-foreground/60 [&:empty]:before:whitespace-pre-line"
          />
        </Field>
        {text && (
          <button type="button" onClick={clearSignature} className="text-xs text-muted-foreground hover:text-destructive">
            Clear signature
          </button>
        )}

        {/* Legacy logo: uploads are gone (paste your signature WITH its logo
            instead), but if one was uploaded before we keep showing it so
            removing it stays possible. */}
        {logoUrl && (
          <Field label="Previously uploaded logo" hint="New signatures should just include the logo in the paste. Remove this if your pasted signature already has it.">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Signature logo"
                className="block max-h-16 max-w-[200px] rounded border border-border bg-white p-1"
              />
              <Button variant="ghost" type="button" onClick={() => setLogoUrl('')}>Remove</Button>
            </div>
          </Field>
        )}

        <Field label="Link (optional)" hint="Adds a clickable line at the bottom of your signature.">
          <Input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://yourcompany.com"
          />
        </Field>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving || !isDirty}>
            {saving ? 'Saving…' : 'Save signature'}
          </Button>
          <Button variant="outline" onClick={sendTest} disabled={testing || isDirty || !savedText}>
            {testing ? 'Sending test…' : 'Send me a test email'}
          </Button>
        </div>
        {isDirty && savedText !== text && (
          <p className="text-[11px] text-muted-foreground">Save first, then send the test so it shows the latest version.</p>
        )}
      </CardContent>
    </Card>
  );
}
