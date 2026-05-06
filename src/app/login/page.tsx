'use client';
import { useState, useEffect, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Button, Input, PasswordInput, Field } from '@/components/ui/primitives';
import { AlertCircle } from 'lucide-react';

interface PublicBranding {
  productName: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
}

const FALLBACK_BRANDING: PublicBranding = {
  productName: 'MCA Platform',
  displayName: 'MCA Platform',
  logoUrl: null,
  primaryColor: '184 70% 22%',
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
  const [branding, setBranding] = useState<PublicBranding>(FALLBACK_BRANDING);

  useEffect(() => {
    fetch('/api/branding/public')
      .then((r) => r.json())
      .then((b) => setBranding({ ...FALLBACK_BRANDING, ...b }))
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
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12 relative overflow-hidden">
      {/* subtle decorative background */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 25% 30%, hsl(var(--primary)) 0, transparent 45%), radial-gradient(circle at 75% 75%, hsl(var(--primary)) 0, transparent 45%)',
        }}
      />

      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="flex flex-col items-center mb-8">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.displayName} className="h-12 w-auto mb-3" />
          ) : (
            <div className="h-11 w-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center mb-3 shadow-sm">
              <span className="text-lg font-semibold tracking-tight">
                {branding.productName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <h1 className="text-xl font-semibold tracking-tight">{branding.productName}</h1>
        </div>

        {/* Login card */}
        <div className="rounded-xl border border-border bg-card shadow-sm p-7">
          <div className="mb-6">
            <h2 className="text-base font-semibold">Sign in to your account</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Enter your email and password.
            </p>
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
              <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full h-10">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-5 pt-5 border-t border-border flex items-center justify-center">
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          {branding.displayName} · Secure login
        </p>
      </div>
    </div>
  );
}
