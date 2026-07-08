'use client';
import * as React from 'react';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastVariant = 'success' | 'error' | 'info';
interface Toast { id: string; variant: ToastVariant; message: string; }

interface ToastContextValue {
  toast: (variant: ToastVariant, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const push = React.useCallback((variant: ToastVariant, message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((arr) => [...arr, { id, variant, message }]);
    setTimeout(() => {
      setToasts((arr) => arr.filter((t) => t.id !== id));
    }, variant === 'error' ? 6000 : 3500);
  }, []);

  const value: ToastContextValue = {
    toast: push,
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            onDismiss={() => setToasts((arr) => arr.filter((x) => x.id !== t.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = toast.variant === 'success' ? CheckCircle2 : toast.variant === 'error' ? AlertCircle : Info;
  return (
    // Neutral card + colored ACCENT RAIL on the left (Stripe/Linear pattern):
    // the semantic color is a signal, not the whole surface. Elevation comes
    // from the theme shadow token so it holds up in dark mode too.
    <div
      className={cn(
        'pointer-events-auto relative flex items-start gap-3 min-w-[300px] max-w-md pl-4 pr-3 py-3 rounded-xl border border-border bg-card text-card-foreground overflow-hidden',
        '[box-shadow:var(--shadow-lg)]',
        'animate-in slide-in-from-top-2 fade-in-0 duration-200'
      )}
      role="status"
      aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-0 bottom-0 w-[3px]',
          toast.variant === 'success' && 'bg-emerald-500',
          toast.variant === 'error' && 'bg-rose-500',
          toast.variant === 'info' && 'bg-primary/60'
        )}
      />
      <Icon
        className={cn(
          'h-5 w-5 shrink-0 mt-0.5',
          toast.variant === 'success' && 'text-emerald-600 dark:text-emerald-400',
          toast.variant === 'error' && 'text-rose-600 dark:text-rose-400',
          toast.variant === 'info' && 'text-muted-foreground'
        )}
      />
      <div className="flex-1 text-sm leading-snug pt-px">{toast.message}</div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-muted-foreground/70 hover:text-foreground transition-colors p-1 -m-1 rounded-md hover:bg-muted"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

/**
 * Standalone fallback for components that may not be inside the provider tree.
 * Prefer useToast() inside the app layout. This uses console + alert as last resort.
 */
export const toastFallback = {
  success: (m: string) => console.log('[toast.success]', m),
  error: (m: string) => alert(m),
  info: (m: string) => console.log('[toast.info]', m),
};
