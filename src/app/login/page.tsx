'use client';
import { useState, useEffect, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Input, PasswordInput, Field } from '@/components/ui/primitives';
import { AlertCircle } from 'lucide-react';

interface PublicBranding {
  productName: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
}

const FALLBACK: PublicBranding = {
  productName: 'Cortada',
  displayName: 'Cortada Capital Group',
  logoUrl: null,
  primaryColor: '222 47% 17%',
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState<PublicBranding>(FALLBACK);

  useEffect(() => {
    fetch('/api/branding/public')
      .then((r) => r.json())
      .then((b) => setBranding({ ...FALLBACK, ...b }))
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError('Email or password is incorrect.');
      return;
    }
    const callbackUrl = search.get('callbackUrl') || '/dashboard';
    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 bg-background overflow-hidden">
      {/* Ambient backdrop — subtle grid + halo for depth, not decoration */}
      <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.5] pointer-events-none" />
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, hsl(var(--foreground) / 0.06), transparent 70%), radial-gradient(ellipse 50% 40% at 50% 100%, hsl(var(--foreground) / 0.04), transparent 70%)',
        }}
      />
      {/* Top + bottom fade so the grid doesn't feel like wallpaper */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent pointer-events-none" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent pointer-events-none" />

      <div className="relative w-full max-w-[400px] animate-fade-up">
        {/* Brand mark — full Cortada logo with text */}
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding.logoUrl || '/brand/cortada-full.png'}
            alt={branding.displayName}
            className="h-16 sm:h-20 w-auto object-contain"
            onError={(e) => {
              // If the stored logo URL is broken, fall back to the bundled file.
              const el = e.currentTarget;
              if (el.src.endsWith('/brand/cortada-full.png')) {
                el.style.display = 'none';
              } else {
                el.src = '/brand/cortada-full.png';
              }
            }}
          />
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[0_1px_3px_0_hsl(222_47%_11%/0.04),_0_20px_40px_-12px_hsl(222_47%_11%/0.08)]">
          <div className="mb-6">
            <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground mt-1">Welcome back.</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                placeholder="you@company.com"
              />
            </Field>

            <Field label="Password">
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </Field>

            {error && (
              <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full h-10 mt-2">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border flex items-center justify-center">
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground/70 mt-6">
          {branding.displayName}
        </p>
      </div>
    </div>
  );
}
