import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users, companies, verificationCodes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateNumericCode, sendSystemEmail, verificationCodeEmail } from '@/lib/email/system';
import { sendGenericEmail, type SmtpConfig } from '@/lib/email/smtp';

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

    // 1) System email service (Resend / SYSTEM_SMTP_*)
    let delivered = false;
    let lastError: string | undefined;
    const sysResult = await sendSystemEmail({
      to: user.email,
      subject: emailData.subject,
      text: emailData.text,
    });
    if (sysResult.sent) delivered = true;
    else lastError = sysResult.error;

    // 2) Fall back to the SMTP the platform already uses for deal emails —
    //    the user's own account first, then the company shared account.
    if (!delivered) {
      const candidates: (SmtpConfig | null)[] = [
        (user.smtpConfig as SmtpConfig | null) ?? null,
      ];
      if (user.companyId) {
        const [company] = await db.select().from(companies)
          .where(eq(companies.id, user.companyId)).limit(1);
        candidates.push((company?.smtpConfig as SmtpConfig | null) ?? null);
      }
      for (const smtp of candidates) {
        if (!smtp || delivered) continue;
        const r = await sendGenericEmail({
          smtp,
          toEmail: user.email,
          ccEmails: [],
          subject: emailData.subject,
          bodyNotes: emailData.text,
          structuredFields: [],
          attachments: [],
        });
        if (r.success) delivered = true;
        else lastError = r.error;
      }
    }

    if (!delivered) {
      // No transport can reach the user. Tell the client explicitly so it
      // can let the login proceed WITHOUT the code — a security feature
      // must never turn into a lockout because email isn't set up yet.
      console.error('[2fa-send] no email transport available:', lastError);
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
