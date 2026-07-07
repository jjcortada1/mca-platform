'use client';
import { useEffect, useRef } from 'react';

/**
 * Background auto-refresh — keeps every screen in sync with what other users
 * are doing without a manual reload.
 *
 * Safety rules baked in:
 *   - Only ticks while the tab is VISIBLE (hidden tabs don't hammer the API).
 *   - Skips a tick while the user is TYPING (focus inside an input/textarea/
 *     select/contenteditable) so a refresh never clobbers a half-filled form.
 *   - Fires immediately when the user returns to the tab.
 *   - `enabled` lets a page pause refresh while a row is expanded/being edited.
 */
export function useAutoRefresh(
  callback: () => void,
  opts?: { intervalMs?: number; enabled?: boolean },
) {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const enabled = opts?.enabled ?? true;
  const intervalMs = opts?.intervalMs ?? 30_000;

  useEffect(() => {
    if (!enabled) return;

    const userIsTyping = () => {
      const ae = document.activeElement as HTMLElement | null;
      if (!ae) return false;
      const tag = ae.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable;
    };

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (userIsTyping()) return;
      cbRef.current();
    };

    const iv = setInterval(tick, intervalMs);
    const onVis = () => { if (document.visibilityState === 'visible' && !userIsTyping()) cbRef.current(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, intervalMs]);
}
