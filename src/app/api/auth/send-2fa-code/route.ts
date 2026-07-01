import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users, verificationCodes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateNumericCode, verificationCodeEmail } from '@/lib/email/system';
import { sendAccountEmail } from '@/lib/email/account-email';

/**
 * Send a 2FA verification code to a user's email.
 * Called after email/password validation but before session creation.
 *
 * Transport order:
 *   1. System email (Resend / SYSTEM_SMTP_*) if configured
 *   2. The user's OWN deal-sending SMTP (per-rep mode) — the code emails
 *      from their account to their account
 *   3. The company shared SMTP
 *   4. Nothing available → respond canSend:false so the login page can
 *      proceed WITHOUT the code instead of locking the user out.
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

    const emailData = verificationCodeEmail(user.name, code, 'log in to your account');

    // Deliver via system email, then the user's / company's own SMTP.
    const res = await sendAccountEmail(user.id, {
      subject: emailData.subject,
      text: emailData.text,
    });

    if (!res.delivered) {
      // No transport can reach the user. Tell the client explicitly so it
      // can let the login proceed WITHOUT the code — a security feature
      // must never turn into a lockout because email isn't set up yet.
      console.error('[2fa-send] no email transport available:', res.error);
      return NextResponse.json(
        {
          canSend: false,
          error: 'No email service is configured to deliver the code.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Verification code sent to your email',
    });
  } catch (err) {
    console.error('[2fa-send]', err);
    return NextResponse.json(
      { error: 'Failed to send verification code' },
      { status: 500 }
    );
  }
}
