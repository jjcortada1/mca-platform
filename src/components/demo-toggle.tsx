'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, Button, Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-provider';
import { FlaskConical, RotateCcw } from 'lucide-react';

/**
 * Demo mode switch. Only rendered for the platform owner, and the API
 * enforces that independently.
 */
export function DemoToggle() {
  const toast = useToast();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/demo', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setEnabled(Boolean(j.data?.enabled));
        setSeeded(Boolean(j.data?.seeded));
        setAllowed(true);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function set(next: boolean, reset = false) {
    setBusy(true);
    try {
      const res = await fetch('/api/settings/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next, reset }),
      });
      if (!res.ok) { toast.error('Could not switch demo mode.'); return; }
      toast.success(next ? 'Demo mode on — reloading with sample data.' : 'Demo mode off — back to your real company.');
      // A full reload is deliberate: every server component re-resolves the
      // company, so the whole app flips in one step instead of piecemeal.
      window.location.href = '/dashboard';
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || !allowed) return null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-muted-foreground" /> Demo mode
              {enabled && <Badge variant="warning">On</Badge>}
            </h3>
            <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed max-w-xl">
              Fills the entire CRM with realistic <span className="font-medium text-foreground">fake</span> data
              — merchants, funders, deals, submissions, commissions — so you can show someone around without
              exposing a single real client. Your live company is never read from or written to; demo data lives
              in its own separate company, and switching back is instant.
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-2">
              While it&apos;s on, a banner sits across the top of every page so demo numbers can never be mistaken
              for real ones. Only you can see or use this.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {enabled && seeded && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Rebuild the demo data?',
                    body: 'Deletes the current demo company and generates a fresh one. Your real data is not involved.',
                    confirmLabel: 'Rebuild',
                  });
                  if (ok) void set(true, true);
                }}
                title="Regenerate the sample data"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant={enabled ? 'outline' : 'default'}
              disabled={busy}
              onClick={() => set(!enabled)}
            >
              {busy ? 'Switching…' : enabled ? 'Turn off demo mode' : 'Turn on demo mode'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
