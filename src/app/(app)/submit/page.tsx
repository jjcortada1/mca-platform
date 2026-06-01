'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Card, CardContent, Button, Input, Textarea, Field, Badge,
} from '@/components/ui/primitives';
import { Paperclip, X, Plus, Mail, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FunderRow {
  id: string;
  name: string;
  // funders.emails — the shopping/submission emails (multiple). Used first.
  emails?: string[] | null;
  contacts: { id: string; name: string; email: string | null; isPrimary: boolean }[];
  tiers?: { id: string; name: string }[];
}

interface CustomFunder { id: string; name: string; email: string; }

interface SendResult {
  funderId?: string;
  funderName: string;
  toEmail: string;
  status: 'ok' | 'error' | 'skipped';
  message?: string;
}

function SubmitDealInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // From shop tab — these are pre-fill hints, not required
  const fromShop = searchParams.get('shop') === '1';
  // When linked from Submissions ("Submit to more funders"), the existing
  // deal's ID is passed so the send route attaches to it instead of creating
  // a duplicate deal.
  const prefillDealId = searchParams.get('dealId') || '';

  const [allFunders, setAllFunders] = useState<FunderRow[]>([]);
  const [companyInfo, setCompanyInfo] = useState<{ globalCcEmails?: string[] }>({});
  const [emailMode, setEmailMode] = useState<'shared' | 'per_rep'>('shared');
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [fromEmail, setFromEmail] = useState<string | null>(null);
  const [reps, setReps] = useState<{ id: string; name: string; role: string }[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  // Form fields
  const [dealName, setDealName] = useState('');
  // When set, the send route reuses this existing deal instead of auto-creating one.
  const [dealId, setDealId] = useState<string>(prefillDealId);
  const [dealLocked, setDealLocked] = useState<boolean>(false);
  const [assignedRepId, setAssignedRepId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [extraCC, setExtraCC] = useState('');

  // Funder selection
  const [activeTier, setActiveTier] = useState<string | null>(null);
  const [selectedFunderIds, setSelectedFunderIds] = useState<Set<string>>(new Set());
  const [customFunders, setCustomFunders] = useState<CustomFunder[]>([]);

  // Send state
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SendResult[] | null>(null);

  // Initial load
  useEffect(() => {
    Promise.all([
      fetch('/api/funders', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/settings/company').then((r) => r.json()).catch(() => ({})),
      fetch('/api/settings/smtp').then((r) => r.json()).catch(() => ({})),
      fetch('/api/auth/me').then((r) => r.json()).catch(() => ({})),
      fetch('/api/users').then((r) => r.json()).catch(() => ({})),
    ]).then(([fundersJson, companyJson, smtpJson, meJson, usersJson]) => {
      const list = fundersJson.data ?? fundersJson.funders ?? [];
      setAllFunders(list);
      const tiers = collectAllTiers(list);
      if (tiers.length) setActiveTier(tiers[0]);

      const me = meJson?.user;
      const admin = me?.role === 'company_admin' || me?.role === 'master_admin';
      setIsAdmin(admin);
      setMyUserId(me?.id ?? null);
      setAssignedRepId(me?.id ?? '');

      // Filter rep options — exclude lead source users
      const userList = (usersJson?.data ?? usersJson?.users ?? []) as { id: string; name: string; role: string }[];
      setReps(userList.filter((u) => u.role === 'rep' || u.role === 'company_admin' || u.role === 'master_admin'));

      const co = companyJson.data ?? companyJson;
      setCompanyInfo({ globalCcEmails: co?.globalCcEmails ?? [] });
      setEmailMode((co?.emailMode as 'shared' | 'per_rep') ?? 'shared');

      // SMTP API returns { data: { hasConfig, host, port, user, from, mode } }
      const smtpData = smtpJson?.data ?? smtpJson;
      setSmtpConfigured(!!smtpData?.hasConfig);
      setFromEmail(smtpData?.from ?? smtpData?.user ?? null);

      // If we were linked here with a specific dealId ("Submit to more funders"),
      // pull the deal's current info and pre-fill (and lock) the name field so
      // the user can't rename a deal by accident.
      if (prefillDealId) {
        fetch(`/api/deals/${prefillDealId}`)
          .then((r) => r.json())
          .then((j) => {
            const d = j?.data ?? j?.deal ?? j;
            if (d?.name) {
              setDealName(d.name);
              setDealLocked(true);
            }
            if (d?.assignedRepId) setAssignedRepId(d.assignedRepId);
          })
          .catch(() => {});
      }

      // If we came from Shop with funders selected, pre-select them here.
      if (fromShop) {
        try {
          const raw = sessionStorage.getItem('shopSelectedFunderIds');
          if (raw) {
            const ids: string[] = JSON.parse(raw);
            if (Array.isArray(ids) && ids.length) {
              // Only keep IDs that exist in the loaded funder list
              const validIds = new Set(list.map((f: FunderRow) => f.id));
              const preselect = ids.filter((id) => validIds.has(id));
              setSelectedFunderIds(new Set(preselect));
              // Jump to the tier of the first preselected funder so it's visible
              const first = list.find((f: FunderRow) => f.id === preselect[0]);
              const firstTier = first?.tiers?.[0]?.name;
              if (firstTier) setActiveTier(firstTier);
            }
          }
          sessionStorage.removeItem('shopSelectedFunderIds');
        } catch {
          // ignore malformed handoff
        }
      }
    });
  }, [fromShop]);

  const tiers = useMemo(() => collectAllTiers(allFunders), [allFunders]);

  const fundersByTier = useMemo(() => {
    if (!activeTier) return [];
    return allFunders.filter((f) => {
      const fTiers = f.tiers ?? [];
      if (fTiers.length === 0) return activeTier === 'Untiered';
      return fTiers.some((t) => t.name === activeTier);
    });
  }, [allFunders, activeTier]);

  function toggleFunder(id: string) {
    const next = new Set(selectedFunderIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedFunderIds(next);
  }

  function addCustom() {
    setCustomFunders([...customFunders, { id: 'c-' + Date.now(), name: '', email: '' }]);
  }
  function updateCustom(id: string, patch: Partial<CustomFunder>) {
    setCustomFunders((cf) => cf.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function removeCustom(id: string) {
    setCustomFunders((cf) => cf.filter((c) => c.id !== id));
  }

  function handleFiles(incoming: FileList) {
    const arr = Array.from(incoming);
    const existing = new Set(files.map((f) => f.name));
    const fresh = arr.filter((f) => !existing.has(f.name));
    setFiles([...files, ...fresh].slice(0, 30));
  }
  function removeFile(name: string) {
    setFiles(files.filter((f) => f.name !== name));
  }

  const validCustom = customFunders.filter((c) => c.email.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim()));
  const totalRecipients = selectedFunderIds.size + validCustom.length;

  async function send() {
    setError(null);
    if (!dealName.trim()) {
      setError('Business / deal name is required.');
      return;
    }
    if (totalRecipients === 0) {
      setError('Select at least one funder or add a custom recipient with an email.');
      return;
    }
    if (smtpConfigured === false) {
      setError('SMTP is not configured. Go to Settings → SMTP to set it up.');
      return;
    }

    setSending(true);

    // Build payload
    const fd = new FormData();
    fd.append('dealName', dealName.trim());
    if (dealId) fd.append('dealId', dealId);
    if (assignedRepId) fd.append('assignedRepId', assignedRepId);
    fd.append('notes', notes);

    const ccList = [
      ...(companyInfo.globalCcEmails ?? []),
      ...extraCC.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
    ];
    fd.append('ccEmails', JSON.stringify(ccList));

    // Build funders array — directory selections + custom rows.
    // For each selected funder we use funders.emails (the submission/shopping
    // emails). If that list has multiple addresses we fan out — one row per
    // email — so the deal lands in every inbox the funder gave us. We fall
    // back to the primary contact's email only if no shopping emails exist
    // (legacy data).
    const funderTargets: { funderId?: string; manualFunderName?: string; toEmail: string; funderName: string }[] = [];
    for (const id of Array.from(selectedFunderIds)) {
      const f = allFunders.find((x) => x.id === id);
      if (!f) continue;
      const submissionEmails = (f.emails ?? [])
        .map((e) => (e || '').trim())
        .filter((e) => e && e.includes('@'));
      if (submissionEmails.length) {
        for (const em of submissionEmails) {
          funderTargets.push({ funderId: id, toEmail: em, funderName: f.name });
        }
      } else {
        // Fallback: pick primary contact's email (legacy behavior).
        const primary = f.contacts.find((c) => c.isPrimary && c.email) ?? f.contacts.find((c) => c.email);
        if (primary?.email) {
          funderTargets.push({ funderId: id, toEmail: primary.email, funderName: f.name });
        }
      }
    }
    for (const c of validCustom) {
      funderTargets.push({ manualFunderName: c.name || c.email, toEmail: c.email.trim(), funderName: c.name || c.email });
    }

    if (funderTargets.length === 0) {
      setError('No valid recipients. Make sure selected funders have email addresses.');
      setSending(false);
      return;
    }

    fd.append('funders', JSON.stringify(funderTargets));
    files.forEach((f) => fd.append('files', f));

    try {
      const res = await fetch('/api/submissions/send', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Send failed.');
        setSending(false);
        return;
      }
      // Map results
      const sendResults: SendResult[] = (json.results ?? []).map((r: any) => ({
        funderName: r.funderName ?? r.toEmail,
        toEmail: r.toEmail,
        status: r.success ? 'ok' : 'error',
        message: r.error || (r.success ? 'Sent' : 'Failed'),
      }));
      setResults(sendResults);

      const okCount = sendResults.filter((r) => r.status === 'ok').length;
      if (okCount > 0 && sendResults.every((r) => r.status === 'ok')) {
        // All succeeded — give user a moment to see results, then offer redirect
        setTimeout(() => {
          if (confirm('All emails sent! Go to Submissions tab?')) {
            router.push('/submissions');
          }
        }, 1500);
      }
    } catch (err) {
      setError('Network error: ' + (err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">📤 Submit Deal to Funders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Send a deal to one or more funders. Each funder receives a separate email.
        </p>
      </header>

      {fromShop && (
        <div className="text-xs bg-blue-50 border border-blue-200 text-blue-900 rounded px-3 py-2">
          ✓ Carried over from Shop. Pick funders below and send.
        </div>
      )}

      {smtpConfigured === false && (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded px-3 py-2">
          ⚠️ Email is not configured yet. Go to{' '}
          <a href={isAdmin ? '/settings' : '/account'} className="font-medium underline">
            {isAdmin ? 'Settings → SMTP' : 'My account → My email SMTP'}
          </a>{' '}
          to set it up before sending.
        </div>
      )}
      {smtpConfigured && fromEmail && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2 flex items-center gap-2">
          <Mail className="h-3.5 w-3.5" />
          Emails will send from: <strong className="text-foreground">{fromEmail}</strong>
          {emailMode === 'per_rep' ? <Badge variant="outline">per-rep</Badge> : <Badge variant="outline">shared</Badge>}
        </div>
      )}

      {/* Deal name + Assigned rep */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {dealLocked && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
              <span className="font-semibold">Adding more funders</span> to this existing deal. The deal name is locked so you don't accidentally create a duplicate.
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Business / Deal Name" required>
              <Input
                placeholder="e.g. John Smith — Riverside Auto Repair"
                value={dealName}
                onChange={(e) => setDealName(e.target.value)}
                readOnly={dealLocked}
                className={dealLocked ? 'bg-muted/40 cursor-not-allowed' : ''}
              />
            </Field>
            {isAdmin && reps.length > 0 && (
              <Field label="Assign to rep" hint="Who owns this deal">
                <select
                  value={assignedRepId}
                  onChange={(e) => setAssignedRepId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
                >
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.id === myUserId ? ' (me)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardContent className="p-4">
          <Field label="📝 Deal Notes" hint="Becomes the body of the email">
            <Textarea
              rows={6}
              placeholder="Paste your deal summary here…&#10;&#10;Revenue: $45K/mo&#10;Credit: 650+&#10;Position: 1&#10;State: FL&#10;Industry: Auto Repair&#10;Time in business: 4 years&#10;Looking for: $50K"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Attachments */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            Attachments
          </div>
          <div className="text-xs text-muted-foreground">Up to 30 files. Sent with the email — not stored on the server.</div>
          <label className="block">
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition">
              <div className="text-sm font-medium">📁 Drop files or click to browse</div>
              <div className="text-xs text-muted-foreground mt-1">PDF, DOC, XLS, images, anything</div>
            </div>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </label>
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f) => (
                <div key={f.name} className="flex items-center justify-between bg-muted/40 rounded px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">({(f.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </div>
                  <button onClick={() => removeFile(f.name)} className="text-muted-foreground hover:text-destructive p-1">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CC */}
      <Card>
        <CardContent className="p-4">
          <Field label="📧 Additional CC (optional)" hint={
            (companyInfo.globalCcEmails ?? []).length > 0
              ? `Auto-CC: ${(companyInfo.globalCcEmails ?? []).join(', ')}`
              : 'Comma-separated emails'
          }>
            <Input
              placeholder="someone@example.com, another@example.com"
              value={extraCC}
              onChange={(e) => setExtraCC(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Funder selection */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">📨 Select Funders</div>
              <div className="text-xs text-muted-foreground">Browse by tier</div>
            </div>
            {totalRecipients > 0 && (
              <Badge variant="default" className="bg-primary text-primary-foreground">
                {totalRecipients} selected
              </Badge>
            )}
          </div>

          {tiers.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              No funders yet. Add funders in <a href="/funders" className="text-primary hover:underline">Funders</a> first.
            </div>
          ) : (
            <>
              {/* Tier tabs */}
              <div className="flex flex-wrap gap-1 border-b border-border">
                {tiers.map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTier(t)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition',
                      activeTier === t
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Pills for active tier */}
              <div className="space-y-1.5">
                {fundersByTier.map((f) => {
                  const selected = selectedFunderIds.has(f.id);
                  // funders.emails (submission emails) is the source of truth for shopping.
                  // Fall back to a contact's email only if no submission emails exist
                  // (legacy data). Disable the pill if NEITHER exists.
                  const shoppingEmails = (f.emails ?? []).filter((e) => e && e.includes('@'));
                  const primary = f.contacts.find((c) => c.isPrimary && c.email) ?? f.contacts.find((c) => c.email);
                  const displayEmail = shoppingEmails[0] ?? primary?.email ?? null;
                  const extraCount = shoppingEmails.length > 1 ? shoppingEmails.length - 1 : 0;
                  const hasEmail = !!displayEmail;
                  return (
                    <button
                      key={f.id}
                      onClick={() => hasEmail && toggleFunder(f.id)}
                      disabled={!hasEmail}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-md border-2 transition text-left',
                        selected
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-border bg-background hover:border-muted-foreground/30',
                        !hasEmail && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{f.name}</div>
                        {displayEmail ? (
                          <div className="text-xs text-muted-foreground font-mono truncate">
                            {displayEmail}
                            {extraCount > 0 && (
                              <span className="ml-1.5 text-[10px] font-sans px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                +{extraCount}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-amber-600">No submission email — add one to this funder</div>
                        )}
                      </div>
                      <div className={cn(
                        'shrink-0 ml-3 w-5 h-5 rounded border-2 flex items-center justify-center text-xs font-bold',
                        selected ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border'
                      )}>
                        {selected ? '✓' : ''}
                      </div>
                    </button>
                  );
                })}
                {fundersByTier.length === 0 && (
                  <div className="text-xs text-muted-foreground py-3 text-center">
                    No funders in this tier yet.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Custom funders */}
          <div className="border-t border-dashed border-border pt-3 mt-3 space-y-2">
            <div className="text-sm font-medium">➕ Add a Funder Not on the List</div>
            <div className="text-xs text-muted-foreground">
              Type a name and email — included in this send only.
            </div>
            {customFunders.map((c) => (
              <div key={c.id} className="flex gap-2 items-center bg-muted/40 rounded p-2">
                <Input
                  placeholder="Funder / contact name"
                  value={c.name}
                  onChange={(e) => updateCustom(c.id, { name: e.target.value })}
                  className="flex-1"
                />
                <Input
                  type="email"
                  placeholder="email@funder.com"
                  value={c.email}
                  onChange={(e) => updateCustom(c.id, { email: e.target.value })}
                  className="flex-[2]"
                />
                <button
                  onClick={() => removeCustom(c.id)}
                  className="p-2 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addCustom} className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              Add Custom Funder
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 rounded px-4 py-3 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Send button */}
      <Button onClick={send} disabled={sending} className="w-full py-6 text-base">
        <Send className="h-4 w-4 mr-2" />
        {sending ? 'Sending…' : `Send to ${totalRecipients || 0} Funder${totalRecipients === 1 ? '' : 's'} →`}
      </Button>

      {/* Results */}
      {results && (
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-semibold mb-3">📬 Send Results</div>
            <div className="space-y-1">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-center justify-between py-2 px-3 rounded border-l-4 text-sm',
                    r.status === 'ok' ? 'border-emerald-500 bg-emerald-50' : 'border-red-500 bg-red-50'
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.funderName}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{r.toEmail}</div>
                  </div>
                  <div className={cn(
                    'shrink-0 ml-3 text-xs font-medium',
                    r.status === 'ok' ? 'text-emerald-700' : 'text-red-700'
                  )}>
                    {r.status === 'ok' ? '✓ Sent' : `✗ ${r.message}`}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function SubmitPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <SubmitDealInner />
    </Suspense>
  );
}

function collectAllTiers(funders: FunderRow[]): string[] {
  const set = new Set<string>();
  for (const f of funders) {
    if (!f.tiers || f.tiers.length === 0) {
      set.add('Untiered');
    } else {
      f.tiers.forEach((t) => set.add(t.name));
    }
  }
  return Array.from(set).sort();
}
