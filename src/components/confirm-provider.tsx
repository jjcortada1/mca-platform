'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * App-wide confirm dialog. Replaces native `window.confirm()` — which pops at
 * the TOP of the browser — with a centered, on-brand modal.
 *
 * Usage (in any client component under <ConfirmProvider>):
 *   const confirm = useConfirm();
 *   if (!(await confirm('Delete this?'))) return;
 *   // or: await confirm({ title, description, confirmLabel, destructive })
 */
type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmFn = (opts: string | ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fallback to native confirm if used outside the provider (shouldn't
    // happen in-app, but keeps the hook safe).
    return async (opts) =>
      typeof window !== 'undefined'
        ? window.confirm(typeof opts === 'string' ? opts : opts.title)
        : false;
  }
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    const normalized: ConfirmOptions = typeof opts === 'string' ? { title: opts } : opts;
    setState({ ...normalized, open: true });
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const finish = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setState((s) => (s ? { ...s, open: false } : s));
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialog
          open={state.open}
          title={state.title}
          description={state.description}
          confirmLabel={state.confirmLabel ?? 'Confirm'}
          cancelLabel={state.cancelLabel ?? 'Cancel'}
          destructive={state.destructive}
          onConfirm={() => finish(true)}
          onCancel={() => finish(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}
