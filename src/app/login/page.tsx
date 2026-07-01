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
  const [twoFACode, setTwoFACode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState<PublicBranding>(FALLBACK);
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/branding/public')
      .then((r) => r.json())
      .then((b) => setBranding({ ...FALLBACK, ...b }))
      .catch(() => {});
  }, []);

  async function onCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Check credentials and see if 2FA is required
      const checkRes = await fetch('/api/auth/check-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!checkRes.ok) {
        const errorData = await checkRes.json().catch(() => ({}));
        setError(errorData.error || 'Login failed. Please try again.');
        setLoading(false);
        return;
      }

      const userData = await checkRes.json();
      if (!userData.success) {
        setError(userData.error || 'Login failed. Please try again.');
        setLoading(false);
        return;
      }

      // Check if 2FA is enabled
      if (userData.twoFactorEnabled) {
        setUserId(userData.userId);
        // Send 2FA code
        const sendRes = await fetch('/api/auth/send-2fa-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userData.userId }),
        });

        if (!sendRes.ok) {
          const errorData = await sendRes.json().catch(() => ({}));
          setError(errorData.error || 'Failed to send verification code.');
          setLoading(false);
          return;
        }

        setStep('2fa');
        setLoading(false);
        return;
      }

      // No 2FA required, sign in directly
      const res = await signIn('credentials', { email, password, redirect: false });
      setLoading(false);
      if (res?.error) {
        setError('Email or password is incorrect.');
        return;
      }
      const callbackUrl = sanitizeCallbackUrl(search.get('callbackUrl'));
      router.push(callbackUrl);
      router.refresh();
    } catch (err) {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  }

  async function onTwoFASubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!userId) {
      setError('Session lost. Please start over.');
      setLoading(false);
      return;
    }

    try {
      // Verify 2FA code
      const verifyRes = await fetch('/api/auth/verify-2fa-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, code: twoFACode }),
      });

      if (!verifyRes.ok) {
        const errorData = await verifyRes.json().catch(() => ({}));
        setError(errorData.error || 'Verification failed.');
        setLoading(false);
        return;
      }

      const verifyData = await verifyRes.json();
      if (!verifyData.valid) {
        setError(verifyData.error || 'Invalid verification code.');
        setLoading(false);
        return;
      }

      // Sign in with 2FA provider
      const res = await signIn('2fa', { userId, redirect: false });
      setLoading(false);
      if (res?.error) {
        setError('Failed to create session.');
        return;
      }
      const callbackUrl = sanitizeCallbackUrl(search.get('callbackUrl'));
      router.push(callbackUrl);
      router.refresh();
    } catch (err) {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  }

  const onSubmit = step === 'credentials' ? onCredentialsSubmit : onTwoFASubmit;

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
            {step === 'credentials' ? (
              <>
                <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
                <p className="text-sm text-muted-foreground mt-1">Welcome back.</p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold tracking-tight">Verification code</h2>
                <p className="text-sm text-muted-foreground mt-1">Enter the code sent to your email.</p>
              </>
            )}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {step === 'credentials' ? (
              <>
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
              </>
            ) : (
              <Field label="6-digit code">
                <Input
                  type="text"
                  value={twoFACode}
                  onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoFocus
                  placeholder="000000"
                  maxLength={6}
                  inputMode="numeric"
                />
              </Field>
            )}

            {error && (
              <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full h-10 mt-2">
              {loading ? (step === 'credentials' ? 'Signing in…' : 'Verifying…') : (step === 'credentials' ? 'Sign in' : 'Verify')}
            </Button>
          </form>

          {step === 'credentials' && (
            <div className="mt-6 pt-5 border-t border-border flex items-center justify-center">
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Forgot password?
              </Link>
            </div>
          )}

          {step === '2fa' && (
            <div className="mt-6 pt-5 border-t border-border flex items-center justify-center">
              <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setError(null);
                  setTwoFACode('');
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Back to login
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground/70 mt-6">
          {branding.displayName}
        </p>
      </div>
    </div>
  );
}

/**
 * Prevent open-redirect: only same-site relative paths starting with a single
 * "/" are allowed. Anything else (protocol-relative "//evil.com", absolute
 * "https://evil.com", or URL-encoded variants) falls back to /dashboard.
 */
function sanitizeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return '/dashboard';
  let s = String(raw).trim();
  try { s = decodeURIComponent(s); } catch { /* ignore */ }
  // Must start with single "/" and not "//" (protocol-relative)
  if (!s.startsWith('/') || s.startsWith('//')) return '/dashboard';
  // No scheme allowed inside
  if (/^\/[a-z][\w+.-]*:/i.test(s)) return '/dashboard';
  // No control chars
  if (/[\r\n\0]/.test(s)) return '/dashboard';
  return s;
}
