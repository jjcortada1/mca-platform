import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db/client';
import { users, verificationCodes } from '@/lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * Verify a 2FA code and issue a ONE-TIME session token.
 * Called from the login page after the user enters the emailed code.
 *
 * Request body:  { userId: string, code: string }
 * Response:      { valid: true, sessionToken } | { valid: false, error }
 *
 * SECURITY: verification must be proven to the NextAuth '2fa' provider, or
 * anyone could create a session from a bare userId. On success we mint a
 * short-lived, single-use token (stored hashed, purpose 'login_2fa_session')
 * that the client hands to signIn('2fa'). The provider consumes it. Without
 * a valid token, no session is created — the userId alone is not enough.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, code } = body;

    if (!userId || !code) {
      return NextResponse.json({ valid: false, error: 'User ID and code required' }, { status: 400 });
    }
    if (typeof code !== 'string' || code.length !== 6 || !/^\d+$/.test(code)) {
      return NextResponse.json({ valid: false, error: 'Invalid code format' }, { status: 400 });
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Find a valid, unexpired, UNUSED code for this user. isNull() (not
    // eq(col,null)) — `col = NULL` is always false in SQL and would make
    // every verification fail.
    const [vcRecord] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.userId, userId),
          eq(verificationCodes.purpose, 'login_2fa'),
          eq(verificationCodes.codeHash, codeHash),
          isNull(verificationCodes.usedAt),
        )
      )
      .limit(1);

    if (!vcRecord) {
      return NextResponse.json({ valid: false, error: 'Invalid verification code' }, { status: 401 });
    }
    if (new Date() > vcRecord.expiresAt) {
      return NextResponse.json({ valid: false, error: 'Verification code expired' }, { status: 401 });
    }

    // Consume the code.
    await db.update(verificationCodes).set({ usedAt: new Date() }).where(eq(verificationCodes.id, vcRecord.id));

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.isActive) {
      return NextResponse.json({ valid: false, error: 'User account is inactive' }, { status: 401 });
    }

    // Mint the one-time session token (valid 2 minutes, single use).
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    await db.insert(verificationCodes).values({
      userId: user.id,
      purpose: 'login_2fa_session',
      codeHash: sessionTokenHash,
      expiresAt: new Date(Date.now() + 2 * 60_000),
    });

    return NextResponse.json({ valid: true, sessionToken });
  } catch (err) {
    console.error('[2fa-verify]', err);
    return NextResponse.json({ valid: false, error: 'Failed to verify code' }, { status: 500 });
  }
}
