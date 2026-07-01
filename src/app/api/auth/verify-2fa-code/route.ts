import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users, verificationCodes } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Verify a 2FA code and return user data for session creation.
 * Called from the login page after user enters the 2FA code.
 *
 * Request body:
 *   { userId: string, code: string }
 *
 * Response:
 *   { valid: true, user: {...} } on success
 *   { valid: false, error: string } on failure
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, code } = body;

    if (!userId || !code) {
      return NextResponse.json(
        { valid: false, error: 'User ID and code required' },
        { status: 400 }
      );
    }

    if (typeof code !== 'string' || code.length !== 6 || !/^\d+$/.test(code)) {
      return NextResponse.json(
        { valid: false, error: 'Invalid code format' },
        { status: 400 }
      );
    }

    const codeHash = await import('crypto').then(c =>
      c.createHash('sha256').update(code).digest('hex')
    );

    // Find a valid, unexpired, unused code for this user
    const [vcRecord] = await db
      .select()
      .from(verificationCodes)
      .where(
        and(
          eq(verificationCodes.userId, userId),
          eq(verificationCodes.purpose, 'login_2fa'),
          eq(verificationCodes.codeHash, codeHash),
          eq(verificationCodes.usedAt, null)
        )
      )
      .limit(1);

    if (!vcRecord) {
      return NextResponse.json(
        { valid: false, error: 'Invalid verification code' },
        { status: 401 }
      );
    }

    // Check if code is expired
    if (new Date() > vcRecord.expiresAt) {
      return NextResponse.json(
        { valid: false, error: 'Verification code expired' },
        { status: 401 }
      );
    }

    // Mark code as used
    await db
      .update(verificationCodes)
      .set({ usedAt: new Date() })
      .where(eq(verificationCodes.id, vcRecord.id));

    // Get user data for session
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.isActive) {
      return NextResponse.json(
        { valid: false, error: 'User account is inactive' },
        { status: 401 }
      );
    }

    // Update last login
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));

    return NextResponse.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      }
    });
  } catch (err) {
    console.error('[2fa-verify]', err);
    return NextResponse.json(
      { valid: false, error: 'Failed to verify code' },
      { status: 500 }
    );
  }
}
