'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Brand logo with a guaranteed graceful fallback.
 *
 * Shows the company's uploaded logo when one is set. If there's no logo — or
 * the URL fails to load — it renders a clean lettermark (the company's
 * initial on the brand color) instead of a broken-image icon. This fixes
 * logos "not showing" when public/brand/*.png didn't exist and no tenant
 * logo was configured.
 */
export function BrandMark({
  logoUrl,
  name,
  size = 36,
  rounded = 'lg',
  className,
}: {
  logoUrl?: string | null;
  name?: string | null;
  size?: number;
  rounded?: 'md' | 'lg' | 'xl' | 'full';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name || 'C').trim().charAt(0).toUpperCase() || 'C';
  const radius = rounded === 'full' ? 'rounded-full' : rounded === 'xl' ? 'rounded-xl' : rounded === 'md' ? 'rounded-md' : 'rounded-lg';

  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name || 'Logo'}
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        className={cn(radius, 'object-contain bg-card border border-border p-1 shrink-0', className)}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className={cn(
        radius,
        'shrink-0 flex items-center justify-center bg-primary text-primary-foreground font-bold tracking-tight',
        className,
      )}
    >
      <span style={{ fontSize: Math.round(size * 0.44) }}>{initial}</span>
    </div>
  );
}
