import { db } from '@/lib/db/client';
import { users, companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { sendSystemEmail } from '@/lib/email/system';
import { sendGenericEmail, type SmtpConfig } from '@/lib/email/smtp';

/**
 * Deliver an ACCOUNT/SECURITY email (2FA code, password-reset link,
 * password-change code) to a user, trying every transport in order so a
 * fresh install with no dedicated email service still works:
 *
 *   1. System email service   — Resend / SYSTEM_SMTP_* (best: neutral sender)
 *   2. The user's OWN SMTP     — the account they shop deals with
 *   3. The company shared SMTP — when the company sends via one account
 *
 * Returns whether ANY transport delivered it, so callers can decide what to
 * do when nothing can (e.g. return a fallback link/code to the user instead
 * of leaving them stuck). This is the single place all security emails go
 * through — fix delivery once, fix it everywhere.
 */
export interface AccountEmailResult {
  delivered: boolean;
  via?: 'system' | 'user_smtp' | 'company_smtp';
  error?: string;
}

export async function sendAccountEmail(
  userId: string,
  msg: { subject: string; text: string },
): Promise<AccountEmailResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { delivered: false, error: 'User not found' };

  // 1) System email service (Resend / SYSTEM_SMTP_*).
  const sys = await sendSystemEmail({ to: user.email, subject: msg.subject, text: msg.text });
  if (sys.sent) return { delivered: true, via: 'system' };
  let lastError = sys.error;

  // 2) The user's own SMTP.
  const userSmtp = (user.smtpConfig as SmtpConfig | null) ?? null;
  if (userSmtp) {
    const r = await sendGenericEmail({
      smtp: userSmtp, toEmail: user.email, ccEmails: [],
      subject: msg.subject, bodyNotes: msg.text, structuredFields: [], attachments: [],
    });
    if (r.success) return { delivered: true, via: 'user_smtp' };
    lastError = r.error;
  }

  // 3) The company shared SMTP.
  if (user.companyId) {
    const [company] = await db.select().from(companies).where(eq(companies.id, user.companyId)).limit(1);
    const companySmtp = (company?.smtpConfig as SmtpConfig | null) ?? null;
    if (companySmtp) {
      const r = await sendGenericEmail({
        smtp: companySmtp, toEmail: user.email, ccEmails: [],
        subject: msg.subject, bodyNotes: msg.text, structuredFields: [], attachments: [],
      });
      if (r.success) return { delivered: true, via: 'company_smtp' };
      lastError = r.error;
    }
  }

  return { delivered: false, error: lastError };
}
