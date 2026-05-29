'use client';
import { useState, useEffect, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Input, PasswordInput, Field } from '@/components/ui/primitives';
import { AlertCircle, ShieldCheck, BarChart3, Users, Building2 } from 'lucide-react';

interface PublicBranding {
  productName: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
}

const FALLBACK: PublicBranding = {
  productName: 'MCA Platform',
  displayName: 'MCA Platform',
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
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      {/* LEFT: brand / feature panel */}
      <aside className="relative hidden lg:flex flex-col justify-between p-10 xl:p-14 overflow-hidden bg-foreground text-background">
        {/* subtle grid + halo */}
        <div className="absolute inset-0 opacity-[0.06] bg-grid pointer-events-none" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 70% 60% at 20% 10%, hsl(var(--background) / 0.10), transparent 60%), radial-gradient(ellipse 60% 50% at 90% 90%, hsl(var(--background) / 0.06), transparent 60%)',
          }}
        />

        <div className="relative flex items-center gap-3">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.displayName} className="h-9 w-9 rounded-lg object-contain bg-background/90 p-1" />
          ) : (
            <div className="h-9 w-9 rounded-lg bg-background/95 text-foreground flex items-center justify-center font-semibold">
              {branding.productName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="font-semibold tracking-tight">{branding.displayName}</div>
        </div>

        <div className="relative max-w-md animate-fade-up">
          <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight leading-[1.1]">
            The operating system for your MCA brokerage.
          </h1>
          <p className="mt-4 text-background/70 text-[15px] leading-relaxed">
            Submissions, funder matching, commission tracking, lead source payouts, and a live portfolio — all in one place.
          </p>

          <div className="mt-10 space-y-5">
            <Feature icon={<BarChart3 className="h-4 w-4" />} title="Live portfolio tracking" body="Watch every funded deal pay down in real time — no manual entry." />
            <Feature icon={<Users className="h-4 w-4" />} title="Rep + lead source views" body="Each user sees only what they're meant to. Privacy by default." />
            <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Built for compliance" body="Encrypted credentials, audit trails, soft-delete history." />
            <Feature icon={<Building2 className="h-4 w-4" />} title="Funder relationships, mapped" body="Match deals to funders by criteria, save restrictions, and track outcomes." />
          </div>
        </div>

        <div className="relative text-xs text-background/50">
          © {new Date().getFullYear()} {branding.displayName}
        </div>
      </aside>

      {/* RIGHT: sign-in form */}
      <main className="relative flex items-center justify-center p-6 sm:p-10 bg-background">
        <div className="absolute inset-0 -z-10 bg-halo pointer-events-none" aria-hidden />

        <div className="w-full max-w-sm animate-fade-up">
          {/* mobile brand mark */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt={branding.displayName} className="h-9 w-9 rounded-lg object-contain border border-border bg-card p-1" />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-foreground text-background flex items-center justify-center font-semibold">
                {branding.productName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="font-semibold tracking-tight">{branding.displayName}</div>
          </div>

          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1.5">Sign in to {branding.productName}.</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4 mt-7">
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

          <div className="mt-6 flex items-center justify-between text-xs">
            <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground transition-colors">
              Forgot your password?
            </Link>
            <span className="text-muted-foreground/70">Secure login</span>
          </div>
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-7 w-7 rounded-md bg-background/10 border border-background/15 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-background/60 mt-0.5 leading-relaxed">{body}</div>
      </div>
    </div>
  );
}
