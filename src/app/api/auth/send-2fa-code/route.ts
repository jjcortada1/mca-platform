import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users, verificationCodes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateNumericCode, sendSystemEmail, verificationCodeEmail } from '@/lib/email/system';

/**
 * Send a 2FA verification code to a user's email.
 * Called after email/password validation but before session creation.
 *
 * Request body:
 *   { userId: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId } = body;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.twoFactorEnabled) {
      return NextResponse.json({ error: 'Two-factor auth not enabled for this user' }, { status: 400 });
    }

    // Generate a 6-digit code
    const code = generateNumericCode(6);
    const codeHash = await import('crypto').then(c =>
      c.createHash('sha256').update(code).digest('hex')
    );

    // Create verification code record (expires in 10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await db.insert(verificationCodes).values({
      userId,
      purpose: 'login_2fa',
      codeHash,
      expiresAt,
    });

    // Send email
    const emailData = verificationCodeEmail(user.name, code, 'log in to your account');
    const result = await sendSystemEmail({
      to: user.email,
      subject: emailData.subject,
      text: emailData.text,
    });

    if (!result.sent && !result.dev) {
      return NextResponse.json(
        { error: `Failed to send verification code: ${result.error}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      devMode: result.dev,
      message: 'Verification code sent to your email'
    });
  } catch (err) {
    console.error('[2fa-send]', err);
    return NextResponse.json(
      { error: 'Failed to send verification code' },
      { status: 500 }
    );
  }
}
