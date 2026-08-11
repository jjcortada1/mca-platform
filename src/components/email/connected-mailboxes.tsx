'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, Button, Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-provider';
import { Mail, Link2, Unlink, AlertTriangle, CheckCircle2, Inbox } from 'lucide-react';

interface Mailbox {
  id: string;
  provider: string;
  emailAddress: string;
  displayName: string | null;
  status: 'connected' | 'needs_reauth' | 'error' | string;
  lastError: string | null;
  canRead: boolean;
  sendEnabled: boolean;
}

/**
 * Connect a Gmail mailbox so the CRM sends AS the user.
 *
 * Sending-only is the default because it works with an unverified Google
 * app. Read access (needed for reply capture and the inbox) is a separate,
 * explicit opt-in since Google treats it as a restricted scope.
 */
export function ConnectedMailboxes() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Mailbox[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/email/accounts', { cache: 'no-store' });
      const j = await res.json();
      if (res.ok) {
        setRows(Array.isArray(j.data) ? j.data : []);
        setConfigured(Boolean(j.configured));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The OAuth callback bounces back here with a result in the query string.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const status = p.get('email');
    const msg = p.get('msg');
    if (!status) return;
    if (status === 'connected') toast.success(msg || 'Mailbox connected.');
    else toast.error(msg || 'Could not connect that mailbox.');
    const url = new URL(window.location.href);
    url.searchParams.delete('email');
    url.searchParams.delete('msg');
    window.history.replaceState({}, '', url.toString());
  }, [toast]);

  async function disconnect(m: Mailbox) {
    const ok = await confirm({
      title: `Disconnect ${m.emailAddress}?`,
      body: 'Cortada will stop sending from this mailbox and will forget its access. Sending falls back to your SMTP settings. Nothing already sent is affected.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/email/accounts/${m.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Mailbox disconnected.'); void load(); }
    else toast.error('Could not disconnect that mailbox.');
  }

  async function toggleSend(m: Mailbox) {
    const res = await fetch(`/api/email/accounts/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendEnabled: !m.sendEnabled }),
    });
    if (res.ok) void load();
    else toast.error('Could not update that mailbox.');
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" /> Connected email
            </h3>
            <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed max-w-xl">
              Connect your Gmail so Cortada sends <span className="font-medium text-foreground">as you</span> — mail
              lands in your real Sent folder and threads properly when a funder replies. Without a connection,
              sending keeps using your SMTP settings below.
            </p>
          </div>
          {configured && (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" onClick={() => { window.location.href = '/api/email/google/connect'; }}>
                <Link2 className="h-4 w-4 mr-1.5" /> Connect Gmail
              </Button>
            </div>
          )}
        </div>

        {!configured && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/25 p-3 text-[12.5px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Google email isn&apos;t set up on this server yet. An admin needs to add
              <code className="mx-1 font-mono text-[11.5px]">GOOGLE_CLIENT_ID</code> and
              <code className="mx-1 font-mono text-[11.5px]">GOOGLE_CLIENT_SECRET</code>
              — the steps are in <span className="font-medium">docs/google-email-setup.md</span>.
            </span>
          </div>
        )}

        {loading ? (
          <div className="text-[12.5px] text-muted-foreground">Checking connected mailboxes…</div>
        ) : rows.length === 0 ? (
          configured && (
            <div className="text-[12.5px] text-muted-foreground">
              No mailbox connected yet.
            </div>
          )
        ) : (
          <ul className="divide-y divide-border border border-border rounded-md">
            {rows.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium truncate">{m.emailAddress}</span>
                    {m.status === 'connected'
                      ? <Badge variant="success">Connected</Badge>
                      : <Badge variant="destructive">Reconnect needed</Badge>}
                    {m.sendEnabled && m.status === 'connected' && <Badge variant="outline">Sends from here</Badge>}
                    {m.canRead && <Badge variant="outline">Read access</Badge>}
                  </div>
                  {m.lastError && <div className="text-[11.5px] text-rose-600 mt-0.5">{m.lastError}</div>}
                  {!m.canRead && m.status === 'connected' && (
                    <div className="text-[11.5px] text-muted-foreground mt-0.5">
                      Sending only. Reply capture and the in-app inbox need read access.
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!m.canRead && (
                    <Button
                      variant="outline"
                      className="h-8"
                      onClick={() => { window.location.href = '/api/email/google/connect?read=1'; }}
                      title="Re-consent, adding permission to read your mail"
                    >
                      <Inbox className="h-3.5 w-3.5 mr-1.5" /> Add read access
                    </Button>
                  )}
                  {m.status === 'needs_reauth' && (
                    <Button className="h-8" onClick={() => { window.location.href = '/api/email/google/connect'; }}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Reconnect
                    </Button>
                  )}
                  {m.status === 'connected' && (
                    <Button variant="outline" className="h-8" onClick={() => toggleSend(m)}>
                      {m.sendEnabled ? 'Use SMTP instead' : 'Send from here'}
                    </Button>
                  )}
                  <Button variant="outline" className="h-8" onClick={() => disconnect(m)}>
                    <Unlink className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
