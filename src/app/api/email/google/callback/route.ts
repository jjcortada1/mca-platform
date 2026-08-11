import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { emailAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { exchangeCode, fetchProfile, encryptToken, googleConfigured } from '@/lib/email/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(message: string, ok: boolean): NextResponse {
  const base = (process.env.NEXTAUTH_URL ?? '').replace(/\/+$/, '');
  const url = `${base}/account?email=${ok ? 'connected' : 'error'}&msg=${encodeURIComponent(message)}`;
  const res = NextResponse.redirect(url);
  res.cookies.set('gmail_oauth_state', '', { path: '/', maxAge: 0 });
  return res;
}

/**
 * GET /api/email/google/callback — finish the OAuth flow.
 *
 * Verifies the state nonce against the cookie AND that the state's user id
 * matches the signed-in session, then stores the (encrypted) tokens.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenantContext();
    if (!googleConfigured()) return back('Google email is not configured on this server.', false);

    const url = new URL(req.url);
    const error = url.searchParams.get('error');
    if (error) return back(error === 'access_denied' ? 'Connection cancelled.' : error, false);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? '';
    if (!code) return back('Google did not return an authorization code.', false);

    const [nonce, stateUserId] = state.split('.');
    const cookieNonce = req.headers.get('cookie')?.match(/gmail_oauth_state=([^;]+)/)?.[1];
    if (!nonce || !cookieNonce || nonce !== cookieNonce || stateUserId !== ctx.user.id) {
      return back('This connection link was invalid or expired. Start again from Settings.', false);
    }

    const tokens = await exchangeCode(code);
    const profile = await fetchProfile(tokens.accessToken);

    const existing = await db.select().from(emailAccounts)
      .where(and(
        eq(emailAccounts.userId, ctx.user.id),
        eq(emailAccounts.provider, 'google'),
        eq(emailAccounts.emailAddress, profile.email),
      ))
      .limit(1);

    const values = {
      accessToken: encryptToken(tokens.accessToken),
      // Google only returns a refresh token on first consent; keep the one
      // we already hold if this reconnect didn't include one.
      refreshToken: tokens.refreshToken
        ? encryptToken(tokens.refreshToken)
        : (existing[0]?.refreshToken ?? null),
      tokenExpiresAt: tokens.expiresAt,
      scope: tokens.scope,
      displayName: profile.name,
      status: 'connected' as const,
      lastError: null,
      updatedAt: new Date(),
    };

    if (existing.length) {
      await db.update(emailAccounts).set(values).where(eq(emailAccounts.id, existing[0].id));
    } else {
      await db.insert(emailAccounts).values({
        userId: ctx.user.id,
        companyId: ctx.companyId,
        provider: 'google',
        emailAddress: profile.email,
        ...values,
      });
    }

    return back(`${profile.email} connected.`, true);
  } catch (e) {
    if (e instanceof Error && /unauthor|forbidden|session/i.test(e.message)) return apiError(e);
    return back(e instanceof Error ? e.message : 'Could not complete the Google connection.', false);
  }
}
