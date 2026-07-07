'use client';
/**
 * Send Application — type a name + email and Dropbox Sign emails them the
 * application template for signature. Recent sends are listed below.
 * Admin config (API key / template / role) lives in Settings → E-sign.
 */
import { useEffect, useState } from 'react';
import {
  PageHeader, Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, Input, Textarea, Field, Badge, EmptyState,
} from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import { FileSignature, Send } from 'lucide-react';

interface EsignRow {
  id: string;
  recipientName: string;
  recipientEmail: string;
  status: string;
  createdAt: string;
  senderName: string | null;
}

export default function EsignPage() {
  const toast = useToast();
  const [rows, setRows] = useState<EsignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/esign/send', { cache: 'no-store' });
      const j = await res.json();
      if (res.ok) setRows(j.data ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);
  useAutoRefresh(() => { load(); }, { intervalMs: 60_000 });

  async function send() {
    if (!name.trim()) { toast.error('Enter the recipient\'s name.'); return; }
    if (!email.trim().includes('@')) { toast.error('Enter a valid email.'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/esign/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message: message || null }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || 'Could not send.'); return; }
      toast.success(`Application sent to ${email.trim()} for signature.`);
      setName(''); setEmail(''); setMessage('');
      load();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader
        title="Send application"
        description="Enter a name and email — Dropbox Sign emails them your application template to fill out and sign."
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Recipient name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="John Smith" />
            </Field>
            <Field label="Recipient email" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@business.com" />
            </Field>
          </div>
          <Field label="Personal note (optional)">
            <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Added to the signature request email" />
          </Field>
          <Button onClick={send} disabled={sending}>
            <Send className="h-4 w-4" /> {sending ? 'Sending…' : 'Send for signature'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent applications</CardTitle>
          <CardDescription>Everything sent from your company, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={FileSignature} title="Nothing sent yet" description="Applications you send for signature will show up here." />
          ) : (
            <div className="divide-y divide-border/60">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium">{r.recipientName}</span>
                  <span className="text-muted-foreground truncate">{r.recipientEmail}</span>
                  <span className="ml-auto flex items-center gap-3 shrink-0">
                    {r.senderName && <span className="text-[11px] text-muted-foreground">by {r.senderName}</span>}
                    <Badge className="bg-blue-100 text-blue-800 border-blue-200 capitalize">{r.status}</Badge>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{new Date(r.createdAt).toLocaleDateString()}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
