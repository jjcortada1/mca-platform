'use client';
import { useEffect } from 'react';
import { Button } from './primitives';
import { cn } from '@/lib/utils';

/**
 * Lightweight confirmation modal. Replaces browser `confirm()` and `alert()`
 * dialogs throughout the app so destructive actions get a proper review
 * step in-context, not a jarring browser popup at the top of the page.
 *
 * Usage:
 *   const [confirming, setConfirming] = useState<{ x: stuff } | null>(null);
 *   ...
 *   <ConfirmDialog
 *     open={!!confirming}
 *     title="Delete this funded deal?"
 *     description="This permanently removes the deal..."
 *     confirmLabel="Delete"
 *     destructive
 *     onConfirm={() => doDelete(confirming.id)}
 *     onCancel={() => setConfirming(null)}
 *   />
 *
 * The dialog renders as a centered card with a translucent backdrop. Clicking
 * the backdrop or pressing Escape cancels. The confirm button is destructive
 * red when `destructive` is set (delete flows), normal otherwise.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  loading = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  // Esc to cancel. Mounted only when the dialog is open so it doesn't
  // intercept Esc when the dialog isn't visible.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      // Fixed position so it sits above everything; high z-index so it stays
      // above sticky/floating UI on the underlying page.
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onCancel}
    >
      {/* Backdrop — separate div so click-outside cancellation is reliable. */}
      <div className="absolute inset-0 bg-black/40" />
      {/* Card — stopPropagation so clicks inside don't trigger backdrop cancel. */}
      <div
        className="relative bg-card rounded-lg border border-border shadow-xl max-w-sm w-full p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div id="confirm-title" className="text-base font-semibold">{title}</div>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={loading}
            className={cn(destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
          >
            {loading ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
