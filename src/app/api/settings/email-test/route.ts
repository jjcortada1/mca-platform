import { NextResponse } from 'next/server';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { sendSystemEmail, activeEmailTransport } from '@/lib/email/system';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * POST /api/settings/email-test
 * Sends a test email to the logged-in admin's own address and reports the result.
 * Admin only. Used by the "Send test email" button in Settings → Security.
 */
export async function POST() {
  try {
    const ctx = await requireCompanyAdmin();
    const transport = activeEmailTransport();

    if (transport === 'none') {
      return NextResponse.json({
        ok: false,
        transport,
        error: 'No email transport configured. Set RESEND_API_KEY + EMAIL_FROM (recommended) or the SYSTEM_SMTP_* secrets.',
      });
    }

    const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    const to = user?.email;
    if (!to) return NextResponse.json({ ok: false, transport, error: 'Your account has no email on file.' });

    const result = await sendSystemEmail({
      to,
      subject: 'Test email — your platform email is working',
      text:
        `This is a test message confirming your platform can send emails.\n\n` +
        `Transport: ${transport}\n` +
        `If you received this, password resets and verification codes will work.\n`,
    });

    if (result.sent) {
      return NextResponse.json({ ok: true, transport: result.via ?? transport, to });
    }
    return NextResponse.json({ ok: false, transport: result.via ?? transport, error: result.error || 'Send failed.' });
  } catch (e) {
    return apiError(e);
  }
}
