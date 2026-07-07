'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Notification bell — polls /api/notifications, shows an unread badge and a
 * dropdown, and mirrors NEW notifications to the user's physical screen via
 * the browser Notifications API (when the user has granted permission).
 */
export function NotificationBell({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  // Ids we've already mirrored to the desktop so re-polls don't re-fire them.
  const shownRef = useRef<Set<string>>(new Set());
  const firstPollRef = useRef(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      const rows: NotificationRow[] = j.data ?? [];
      setItems(rows);
      setUnread(j.unread ?? 0);

      // Desktop mirror: fire browser notifications for unread items we
      // haven't shown yet. Skip the first poll after page load — those are
      // old items the user will see in the bell; the screen ping is for
      // things that happen while they're working.
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        if (firstPollRef.current) {
          rows.forEach((r) => shownRef.current.add(r.id));
        } else {
          for (const r of rows) {
            if (r.readAt || shownRef.current.has(r.id)) continue;
            shownRef.current.add(r.id);
            try {
              const n = new Notification(r.title, { body: r.body ?? undefined, tag: r.id });
              n.onclick = () => { window.focus(); if (r.link) window.location.href = r.link; };
            } catch { /* some browsers block constructor off-gesture; bell still shows it */ }
          }
        }
      }
      firstPollRef.current = false;
    } catch { /* transient network error — next poll will catch up */ }
  }, []);

  useEffect(() => {
    poll();
    const iv = setInterval(poll, 45_000);
    return () => clearInterval(iv);
  }, [poll]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function markAllRead() {
    setItems((arr) => arr.map((r) => ({ ...r, readAt: r.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    }).catch(() => {});
  }

  async function openItem(r: NotificationRow) {
    setOpen(false);
    if (!r.readAt) {
      setItems((arr) => arr.map((x) => (x.id === r.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [r.id] }),
      }).catch(() => {});
    }
    if (r.link) router.push(r.link);
  }

  async function enableDesktop() {
    if (!('Notification' in window)) return;
    const p = await Notification.requestPermission();
    setPermission(p);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        className={cn('relative p-2 rounded-md hover:bg-muted transition-colors', compact && 'p-1.5')}
      >
        <Bell className={cn('h-5 w-5', compact && 'h-4 w-4')} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <div className="text-sm font-semibold">Notifications</div>
            {unread > 0 && (
              <button onClick={markAllRead} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <Check className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>

          {permission === 'default' && (
            <button
              onClick={enableDesktop}
              className="w-full text-left px-4 py-2 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors border-b border-border"
            >
              Enable desktop alerts — get a screen notification when your deals change
            </button>
          )}
          {permission === 'denied' && (
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border">
              Desktop alerts are blocked in your browser settings for this site.
            </div>
          )}

          <div className="max-h-[380px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing yet — updates to your deals will show up here.</div>
            ) : (
              items.map((r) => (
                <button
                  key={r.id}
                  onClick={() => openItem(r)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-border/60 last:border-b-0 hover:bg-muted/50 transition-colors',
                    !r.readAt && 'bg-primary/[0.04]'
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', r.readAt ? 'bg-transparent' : 'bg-primary')} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium leading-snug">{r.title}</span>
                      {r.body && <span className="block text-xs text-muted-foreground mt-0.5 leading-snug">{r.body}</span>}
                      <span className="block text-[10.5px] text-muted-foreground/70 mt-1">{timeAgo(r.createdAt)}</span>
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
