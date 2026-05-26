'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Input, Field } from '@/components/ui/primitives';
import { CheckCircle2, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border bg-card shadow-sm p-7">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto h-11 w-11 rounded-full bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <h2 className="text-base font-semibold">Check your inbox</h2>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                If an account exists for <strong className="text-foreground">{email}</strong>, we&apos;ve sent a
                password reset link. The link expires in 1 hour.
              </p>
              <p className="text-xs text-muted-foreground/80 mt-3 leading-relaxed">
                Didn&apos;t get it? Email delivery must be configured by an admin
                (system SMTP). Until then, an admin can change passwords from
                Settings &rarr; Security while signed in.
              </p>
              <Link
                href="/login"
                className="mt-5 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-base font-semibold">Reset your password</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  We&apos;ll email you a reset link.
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
                <Button type="submit" loading={loading} className="w-full h-10">
                  Send reset link
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
