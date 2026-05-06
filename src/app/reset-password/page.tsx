'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, PasswordInput, Field } from '@/components/ui/primitives';
import { AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}

function ResetInner() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || 'Reset failed. The link may have expired.');
      return;
    }
    setDone(true);
    setTimeout(() => router.push('/login'), 2000);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border bg-card shadow-sm p-7">
          {done ? (
            <div className="text-center">
              <div className="mx-auto h-11 w-11 rounded-full bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <h2 className="text-base font-semibold">Password updated</h2>
              <p className="text-sm text-muted-foreground mt-2">Redirecting to sign in…</p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-base font-semibold">Set a new password</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter and confirm your new password.
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <Field label="New password" hint="Minimum 8 characters">
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirm password">
                  <PasswordInput
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </Field>

                {error && (
                  <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" loading={loading} className="w-full h-10">
                  Update password
                </Button>
              </form>

              <div className="mt-5 pt-5 border-t border-border flex items-center justify-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
