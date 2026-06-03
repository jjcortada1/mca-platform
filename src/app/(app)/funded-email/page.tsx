'use client';

/**
 * /funded-email
 *
 * Single-recipient "funded" email composer. Uses the admin-defined template
 * from Settings → Funded email template. Rep flow:
 *
 *   1. Pick recipient — type any email OR pick from their saved contacts.
 *   2. Fill in each template field. Each field is its own line in the body,
 *      rendered vertically as "Label: value".
 *   3. Optionally attach files (subject to platform attachment caps).
 *   4. Click Send.
 *
 * Important rules baked in:
 *   - The rep's "Always CC" is NOT applied here (different from deal submissions).
 *   - The global company CC is also NOT applied.
 *   - The rep's signature IS appended.
 *   - Single recipient (no funder fan-out).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Card, CardHeader, CardTitle, CardContent, CardDescription,
  Button, Input, Textarea, Field, PageHeader,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { Plus, X, Send, Paperclip, BookOpen } from 'lucide-react';

interface TemplateField { id?: string; label: string; hint?: string; type?: 'text' | 'date' }
interface FundedTemplate { subject: string; fields: TemplateField[]; attachmentNote?: string | null }

/** A field is a date input if the admin set type='date' OR the label mentions 'date'. */
function isDateField(f: TemplateField): boolean {
  if (f.type === 'date') return true;
  return /\bdate\b/i.test(f.label || '');
}

/** Format a YYYY-MM-DD calendar date for the email body. Returns input unchanged
 *  if it doesn't look like an ISO date (so non-date fields aren't touched). */
function formatDateForBody(v: string): string {
  const m = (v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return v;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Build in UTC and render in UTC so the day never shifts. Same approach
  // as lib/dates.ts to stay consistent with the rest of the app.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
interface SavedContact { id: string; name: string; email: string; company: string | null; notes: string | null }

export default function FundedEmailPage() {
  const toast = useToast();
  const [tmpl, setTmpl] = useState<FundedTemplate | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [showContacts, setShowContacts] = useState(false);

  const [toEmail, setToEmail] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  // values keyed by field index (kept stable while editing)
  const [values, setValues] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/funded-email-template', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/funded-email/contacts', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ]).then(([t, c]) => {
      const d = t?.data ?? null;
      if (d && typeof d === 'object') {
        setTmpl({
          subject: d.subject ?? '',
          fields: Array.isArray(d.fields) ? d.fields : [],
          attachmentNote: d.attachmentNote ?? null,
        });
        setSubject(d.subject ?? '');
      }
      setContacts(c?.data ?? []);
      setLoaded(true);
    });
  }, []);

  function pickContact(c: SavedContact) {
    setToEmail(c.email);
    setShowContacts(false);
  }

  function addCc() {
    const v = ccInput.trim().toLowerCase();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error('Enter a valid email address.');
      return;
    }
    if (ccEmails.includes(v) || v === toEmail.toLowerCase()) {
      setCcInput('');
      return;
    }
    setCcEmails([...ccEmails, v]);
    setCcInput('');
  }
  function removeCc(e: string) { setCcEmails(ccEmails.filter((x) => x !== e)); }

  const totalAttachmentBytes = useMemo(
    () => files.reduce((acc, f) => acc + f.size, 0),
    [files]
  );

  async function send() {
    if (!toEmail.trim()) { toast.error('Recipient email required.'); return; }
    if (!subject.trim()) { toast.error('Subject required.'); return; }

    setSending(true);
    const fd = new FormData();
    fd.append('toEmail', toEmail.trim());
    fd.append('subject', subject.trim());
    fd.append('ccEmails', JSON.stringify(ccEmails));
    fd.append('notes', notes);
    fd.append(
      'fields',
      JSON.stringify(
        (tmpl?.fields ?? []).map((f, i) => ({
          label: f.label,
          // Dates are stored as YYYY-MM-DD in state. Convert them to a human
          // calendar format ("Jan 15, 2026") for the email body so the
          // recipient sees a readable date, not an ISO string.
          value: isDateField(f) ? formatDateForBody(values[i] ?? '') : (values[i] ?? ''),
        })).filter((f) => f.value.trim())
      )
    );
    files.forEach((f, i) => fd.append(`attachment_${i}`, f));

    const res = await fetch('/api/funded-email/send', { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    setSending(false);

    if (!res.ok || !j.ok) {
      toast.error(j.error || 'Send failed.');
      return;
    }
    toast.success('Funded email sent.');
    setToEmail(''); setCcEmails([]); setCcInput('');
    setValues({}); setNotes(''); setFiles([]);
  }

  if (!loaded) return <div className="text-sm text-muted-foreground">Loading…</div>;

  // No template configured — guide the user (or admin) to set it up first.
  if (!tmpl || (!tmpl.subject && tmpl.fields.length === 0)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Funded email" description="Send a funded notification with the template your admin has set up." />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No template configured yet</CardTitle>
            <CardDescription>
              An admin needs to set up the funded email template before this page can be used. Once they do, you&apos;ll see the subject line and a list of fields to fill in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/settings" className="text-sm underline">Go to Settings → Funded email template</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    // max-w-4xl so the form sits on a contained column on wide screens,
    // and space-y-4 (was space-y-6) so the cards stack closer together.
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title="Funded email"
        description="Send a single funded notification. Recipient picks from your saved contacts or type any email."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recipient</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="To">
                <Input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="recipient@example.com"
                />
              </Field>
            </div>
            <Button variant="outline" onClick={() => setShowContacts((s) => !s)}>
              <BookOpen className="h-4 w-4 mr-1.5" />
              {showContacts ? 'Hide saved' : 'Pick saved'}
            </Button>
          </div>

          {showContacts && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
              {contacts.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No saved contacts yet.{' '}
                  <Link href="/funded-email/contacts" className="underline">Manage contacts →</Link>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">Your contacts</div>
                    <Link href="/funded-email/contacts" className="text-xs underline">Manage →</Link>
                  </div>
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => pickContact(c)}
                      className="w-full text-left px-3 py-2 rounded hover:bg-card border border-transparent hover:border-border"
                    >
                      <div className="text-sm font-medium">{c.name}{c.company ? ` · ${c.company}` : ''}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.email}</div>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Field label="CC (optional)">
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={ccInput}
                  onChange={(e) => setCcInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCc(); } }}
                  placeholder="cc@example.com"
                />
                <Button type="button" variant="outline" onClick={addCc}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </Field>
            {ccEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ccEmails.map((e) => (
                  <span key={e} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded">
                    {e}
                    <button onClick={() => removeCc(e)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">
              Your &quot;always CC&quot; from My Account is NOT applied to funded emails. Only the addresses you type here are CC&apos;d.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject</CardTitle>
          <CardDescription>You can adjust the subject before sending if needed.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </CardContent>
      </Card>

      {tmpl.fields.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Information</CardTitle>
            <CardDescription>
              Fill in each field. They&apos;ll appear in the email body one per line, in this order.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* 2-column grid on desktop, single column on narrow viewports.
                Each field is its own grid cell so the page no longer scrolls
                vertically through every input — they pack side-by-side. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tmpl.fields.map((f, i) => (
                <Field key={i} label={f.label} hint={f.hint}>
                  <Input
                    // Date fields get a native date picker. Everything else
                    // is a regular text input. Type is set by the admin
                    // template OR auto-detected when the label mentions "date".
                    type={isDateField(f) ? 'date' : 'text'}
                    value={values[i] ?? ''}
                    onChange={(e) => setValues({ ...values, [i]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes (optional)</CardTitle>
          <CardDescription>
            Free-text added below the structured fields in the email body.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra context you want to include…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Paperclip className="h-4 w-4" /> Attachments
          </CardTitle>
          {tmpl.attachmentNote && (
            <CardDescription className="whitespace-pre-wrap">
              {tmpl.attachmentNote}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            multiple
            onChange={(e) => {
              const newFiles = Array.from(e.target.files ?? []);
              setFiles([...files, ...newFiles]);
              e.target.value = '';
            }}
            className="block text-sm"
          />
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-muted/40 px-3 py-1.5 rounded">
                  <span className="truncate">{f.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                    <button onClick={() => setFiles(files.filter((_, idx) => idx !== i))}>
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="text-[11px] text-muted-foreground">
                Total: {(totalAttachmentBytes / 1024 / 1024).toFixed(2)} MB &nbsp;•&nbsp; Max 50 MB total, 25 MB per file, 30 files.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={send} disabled={sending || !toEmail.trim() || !subject.trim()}>
          <Send className="h-4 w-4 mr-1.5" />
          {sending ? 'Sending…' : 'Send funded email'}
        </Button>
      </div>
    </div>
  );
}
