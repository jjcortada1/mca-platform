'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * MoneyInput — number input that displays comma-formatted while you type,
 * but always reports the clean numeric value via onValueChange.
 *
 * Usage:
 *   <MoneyInput value={amount} onValueChange={setAmount} placeholder="50000" />
 *
 * - `value` is a number | '' (empty string represents "no value")
 * - `onValueChange` receives a number or '' (so you can preserve empty state)
 * - Optional `prefix` (default: '$')
 * - Pass `decimals={2}` to allow cents
 *
 * Internally renders as type="text" (never type="number") so commas can show.
 * Keystrokes are filtered to digits + optional period.
 */
export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'prefix'> {
  value: number | '';
  onValueChange: (v: number | '') => void;
  currencyPrefix?: string | null;
  decimals?: 0 | 2;
}

function formatWithCommas(n: number, decimals: 0 | 2): string {
  if (decimals === 2) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onValueChange, currencyPrefix = '$', decimals = 0, className, onBlur, onFocus, ...props }, ref) => {
    // Local string state so the input doesn't reformat while user is mid-typing
    const [text, setText] = React.useState<string>(() =>
      value === '' || value === null || value === undefined ? '' : formatWithCommas(value, decimals)
    );
    const [focused, setFocused] = React.useState(false);

    // Sync from external value when it changes (e.g. controlled reset)
    React.useEffect(() => {
      if (focused) return; // don't disturb mid-typing
      if (value === '' || value === null || value === undefined) {
        setText('');
      } else {
        setText(formatWithCommas(value, decimals));
      }
    }, [value, decimals, focused]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      // Strip everything but digits and dots
      const raw = e.target.value;
      const cleaned = decimals === 2
        ? raw.replace(/[^\d.]/g, '')
        : raw.replace(/[^\d]/g, '');

      // Don't auto-format while focused — let user see what they're typing.
      // But strip commas so the cleaned digits are what we work with.
      const digitsOnly = cleaned.replace(/,/g, '');
      setText(digitsOnly);

      if (digitsOnly === '' || digitsOnly === '.') {
        onValueChange('');
        return;
      }
      const parsed = decimals === 2 ? parseFloat(digitsOnly) : parseInt(digitsOnly, 10);
      if (Number.isFinite(parsed)) {
        onValueChange(parsed);
      } else {
        onValueChange('');
      }
    }

    function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
      setFocused(false);
      // Reformat with commas now that user is done
      if (text === '' || text === '.') {
        setText('');
      } else {
        const parsed = decimals === 2 ? parseFloat(text) : parseInt(text, 10);
        if (Number.isFinite(parsed)) setText(formatWithCommas(parsed, decimals));
      }
      onBlur?.(e);
    }

    function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
      setFocused(true);
      onFocus?.(e);
    }

    return (
      <div className="relative">
        {currencyPrefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none select-none">
            {currencyPrefix}
          </span>
        )}
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent',
            'disabled:cursor-not-allowed disabled:opacity-50 tabular-nums text-right',
            currencyPrefix && 'pl-7',
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
MoneyInput.displayName = 'MoneyInput';

/**
 * Helper: parse comma-formatted strings back to numbers (for legacy code paths).
 */
export function parseMoneyString(s: string): number {
  const cleaned = s.replace(/[^\d.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
