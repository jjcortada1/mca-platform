'use client';
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ============================================================
   BUTTON
   ============================================================ */

const buttonVariants = cva(
  // Base: rounded, medium weight, subtle scale-down on click, smooth motion.
  // Transitions are 180ms cubic-bezier(0.16, 1, 0.3, 1) — same easing
  // curve used everywhere in globals.css so motion feels consistent.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [transition:background-color_180ms_cubic-bezier(0.16,1,0.3,1),box-shadow_180ms_cubic-bezier(0.16,1,0.3,1),transform_120ms_cubic-bezier(0.16,1,0.3,1),border-color_180ms_cubic-bezier(0.16,1,0.3,1),color_180ms_cubic-bezier(0.16,1,0.3,1)]',
  {
    variants: {
      variant: {
        // Primary — blue accent (#3B82F6). Stripe-/Linear-style filled CTA.
        // Inner highlight + drop shadow give the button just enough depth
        // without feeling pillowy.
        default: 'bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.12),_0_1px_2px_0_hsl(220_16%_0%/0.20)] hover:bg-primary/90 hover:shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.16),_0_3px_8px_-1px_hsl(217_91%_30%/0.35)]',
        // Destructive — red, same internal structure as primary.
        destructive: 'bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.12),_0_1px_2px_0_hsl(220_16%_0%/0.20)] hover:bg-destructive/90',
        // Outline — quiet secondary. Border barely visible at rest, brightens
        // on hover. Background fill on hover for crisp feedback.
        outline: 'border border-border bg-transparent text-foreground hover:bg-muted/50 hover:border-foreground/25',
        // Secondary — filled muted. Used when "outline" doesn't have enough
        // weight (e.g. inside a card the outline would compete with the card border).
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        // Ghost — no chrome, just hover wash. For nav-style chrome.
        ghost: 'hover:bg-muted hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-8 text-[15px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

/* ============================================================
   INPUT
   ============================================================ */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        // Slightly softer border (theme-driven so dark mode renders hairline),
        // gentle inner shadow for depth, no harsh focus outline — we use a
        // subtle ring + border tint at 220ms ease-out-quint so the focus
        // transition is felt rather than seen.
        'flex h-10 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm',
        '[transition:border-color_220ms_cubic-bezier(0.16,1,0.3,1),box-shadow_220ms_cubic-bezier(0.16,1,0.3,1),background-color_220ms_cubic-bezier(0.16,1,0.3,1)]',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'placeholder:text-muted-foreground/50',
        // Focus: 3px tinted ring + brightened border. Color comes from --ring
        // which is the accent blue, so the focus state coordinates with the
        // primary button across the app.
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:border-ring/60',
        'disabled:cursor-not-allowed disabled:opacity-50 tabular-nums',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

/* ============================================================================
 * Money / percent string-input helpers
 * ============================================================================
 *
 * Goal: anywhere the app collects a dollar amount or a percentage, the user
 * should see commas-as-they-type (1,000) for money, and a "%" suffix for
 * percentages. Both wrappers accept a `string` value (matches how forms
 * elsewhere in the app already store these) and emit a CLEAN string (no
 * commas, no $/%) on change so downstream code keeps working unchanged.
 *
 * Why not the existing MoneyInput (number-based)?
 *  - Most forms in this app pass strings around so they can preserve "1000.50"
 *    typing state without coercing to a number every keystroke. Forcing a
 *    swap to number-typed values would touch a lot of unrelated code.
 *  - These wrappers slot in 1-for-1 wherever an Input is used today, with
 *    the same string-in / string-out contract.
 */

/** Insert thousands commas into a digit string, preserving an optional decimal. */
function addCommasToDigitString(input: string): string {
  if (!input) return '';
  // Allow only digits + at most one period
  const cleaned = input.replace(/[^\d.]/g, '');
  const dotIdx = cleaned.indexOf('.');
  let whole = dotIdx === -1 ? cleaned : cleaned.slice(0, dotIdx);
  const frac = dotIdx === -1 ? '' : cleaned.slice(dotIdx); // includes the "."
  // Strip leading zeros but keep a single zero (so "0.05" works)
  whole = whole.replace(/^0+(\d)/, '$1');
  // Add commas
  whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return whole + frac;
}

/** Strip everything except digits and a single decimal point. */
function stripFormat(input: string): string {
  if (!input) return '';
  return input.replace(/[^\d.]/g, '');
}

export interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string;
  onChange: (rawDigits: string) => void;
}

/**
 * String-based currency input. Renders the value with commas while the
 * user types. The `onChange` callback gets the clean digit string (no
 * commas, no $ sign) so persistence code is unchanged.
 *
 * <CurrencyInput value={fundedAmount} onChange={(v) => setForm({...form, fundedAmount: v})} />
 */
export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, className, ...props }, ref) => (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none select-none">$</span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={addCommasToDigitString(value ?? '')}
        onChange={(e) => onChange(stripFormat(e.target.value))}
        className={cn(
          'flex h-10 w-full rounded-lg border border-input bg-card pl-7 pr-3 py-1 text-sm',
          '[transition:border-color_220ms_cubic-bezier(0.16,1,0.3,1),box-shadow_220ms_cubic-bezier(0.16,1,0.3,1),background-color_220ms_cubic-bezier(0.16,1,0.3,1)]',
          'placeholder:text-muted-foreground/50',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:border-ring/60',
          'disabled:cursor-not-allowed disabled:opacity-50 tabular-nums',
          className
        )}
        {...props}
      />
    </div>
  )
);
CurrencyInput.displayName = 'CurrencyInput';

export interface PercentInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string;
  onChange: (rawDigits: string) => void;
}

/**
 * String-based percent input. Same contract as CurrencyInput but renders
 * with a "%" suffix and no thousands commas (a fee % rarely exceeds 100).
 *
 * Use this for fee %, rep split %, etc. — anywhere a percentage is being
 * entered. Replaces the "$ amount" mental model some users were falling
 * into when a plain Input was used for a fee field.
 */
export const PercentInput = React.forwardRef<HTMLInputElement, PercentInputProps>(
  ({ value, onChange, className, ...props }, ref) => (
    <div className="relative">
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={value ?? ''}
        onChange={(e) => {
          // Allow only digits + optional decimal; cap at 100 for sanity.
          const cleaned = stripFormat(e.target.value);
          onChange(cleaned);
        }}
        className={cn(
          'flex h-10 w-full rounded-lg border border-input bg-card px-3 pr-7 py-1 text-sm',
          '[transition:border-color_220ms_cubic-bezier(0.16,1,0.3,1),box-shadow_220ms_cubic-bezier(0.16,1,0.3,1),background-color_220ms_cubic-bezier(0.16,1,0.3,1)]',
          'placeholder:text-muted-foreground/50',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:border-ring/60',
          'disabled:cursor-not-allowed disabled:opacity-50 tabular-nums',
          className
        )}
        {...props}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none select-none">%</span>
    </div>
  )
);
PercentInput.displayName = 'PercentInput';

/**
 * Password input with built-in show/hide toggle eye icon.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    const [show, setShow] = React.useState(false);
    return (
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          ref={ref}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-card px-3 pr-10 py-1 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = 'PasswordInput';

/* ============================================================
   TEXTAREA
   ============================================================ */

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

/* ============================================================
   LABEL & FIELD
   ============================================================ */

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('text-xs font-medium uppercase tracking-wider text-muted-foreground', className)}
    {...props}
  />
));
Label.displayName = 'Label';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}
      {children}
      {hint && !error && <span className="text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

/* ============================================================
   SELECT
   ============================================================ */

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/* ============================================================
   CARD
   ============================================================ */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // Theme-driven shadow tokens (defined in globals.css). Dark mode
        // uses heavier shadows because dark backgrounds need more elevation
        // contrast to feel layered. Easing matches the global motion curve.
        'rounded-xl border border-border bg-card text-card-foreground',
        '[box-shadow:var(--shadow-xs)]',
        '[transition:box-shadow_220ms_cubic-bezier(0.16,1,0.3,1)]',
        'hover:[box-shadow:var(--shadow-sm)]',
        className
      )}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-6 border-b border-border', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold leading-none tracking-tight', className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground leading-relaxed', className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6', className)} {...props} />;
}
export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center p-6 pt-0', className)} {...props} />;
}

/* ============================================================
   BADGE
   ============================================================ */

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'success' | 'destructive' | 'warning' | 'outline' }) {
  const styles = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    destructive: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    outline: 'bg-transparent text-foreground ring-1 ring-border',
  }[variant];
  return <span className={cn('badge-status', styles, className)} {...props} />;
}

/* ============================================================
   SKELETON
   ============================================================ */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/* ============================================================
   EMPTY STATE
   ============================================================ */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-12 px-6', className)}>
      {Icon && (
        <div className="mb-4 rounded-full bg-muted p-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <div className="text-base font-medium">{title}</div>
      {description && <div className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ============================================================
   PAGE HEADER (consistent across all pages)
   ============================================================ */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-6 border-b border-border">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1.5">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[22px] sm:text-[26px] leading-[1.15] font-semibold tracking-tight truncate">{title}</h1>
        {description && <p className="text-sm sm:text-[15px] text-muted-foreground mt-2 leading-relaxed max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/* ============================================================
   SECTION HEADER (subdivisions inside pages)
   ============================================================ */

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {description && <p className="text-xs text-muted-foreground/80 mt-0.5">{description}</p>}
      </div>
      {actions && <div>{actions}</div>}
    </div>
  );
}

/* ============================================================
   MONEY INPUT (re-export from money-input.tsx)
   ============================================================ */

export { MoneyInput, parseMoneyString, type MoneyInputProps } from './money-input';
