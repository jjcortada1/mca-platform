import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { buildAuthUrl, googleConfigured } from '@/lib/email/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/email/google/connect — start the Gmail OAuth flow.
 *
 * A random nonce goes into BOTH the state parameter and an httpOnly
 * cookie; the callback only proceeds when they match. That is what stops
 * someone tricking a signed-in user into attaching an attacker's mailbox
 * to their account.
 *
 * ?read=1 additionally requests gmail.readonly, which is what reply
 * capture and the inbox need. It is a restricted scope — see
 * docs/google-email-setup.md.
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenantContext();
    if (!googleConfigured()) {
      return NextResponse.json(
        { error: 'Google email is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' },
        { status: 400 },
      );
    }

    const url = new URL(req.url);
    const includeRead = url.searchParams.get('read') === '1';
    const nonce = crypto.randomBytes(24).toString('base64url');
    const state = `${nonce}.${ctx.user.id}`;

    const res = NextResponse.redirect(buildAuthUrl(state, includeRead));
    res.cookies.set('gmail_oauth_state', nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    return res;
  } catch (e) { return apiError(e); }
}
