import nodemailer from 'nodemailer';

/**
 * System email sender for ACCOUNT/SECURITY emails: verification codes and
 * password-reset links.
 *
 * Design decision (important):
 *   These emails are SENT from one platform-level system account (SYSTEM_SMTP_*)
 *   and DELIVERED to the user's normal login email. Users do NOT need to set up
 *   any App Password to RECEIVE a code — they just get it at their inbox.
 *
 *   (Per-user Gmail App Passwords are used elsewhere — for sending DEALS to
 *   funders — not for these security emails. Keeping security email on a single
 *   trusted system account means a brand-new rep, or someone locked out, can
 *   always receive a reset code without having configured anything.)
 *
 * Configure once in Replit Secrets:
 *   SYSTEM_SMTP_HOST   e.g. smtp.gmail.com
 *   SYSTEM_SMTP_PORT   e.g. 587
 *   SYSTEM_SMTP_USER   the sending login (full email)
 *   SYSTEM_SMTP_PASS   app password for THAT system account
 *   SYSTEM_SMTP_FROM   optional "Name <email>"; defaults to SYSTEM_SMTP_USER
 */

export function isSystemEmailConfigured(): boolean {
  return Boolean(process.env.SYSTEM_SMTP_HOST && process.env.SYSTEM_SMTP_USER);
}

/**
 * Display name used inside security emails (subjects/bodies). Generic by default
 * so it isn't tied to any business name. Override with APP_NAME in Secrets if
 * you ever want to brand it (e.g. APP_NAME="Account Services").
 */
export const APP_NAME = process.env.APP_NAME || 'Account Security';

export interface SystemEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SystemEmailResult {
  sent: boolean;
  /** In dev (no system SMTP configured) we don't send — caller may surface this. */
  dev?: boolean;
  error?: string;
}

export async function sendSystemEmail(input: SystemEmailInput): Promise<SystemEmailResult> {
  if (!isSystemEmailConfigured()) {
    // Dev fallback: log instead of sending so flows are testable without SMTP.
    console.log(`[DEV system-email] To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}`);
    return { sent: false, dev: true };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SYSTEM_SMTP_HOST,
      port: parseInt(process.env.SYSTEM_SMTP_PORT ?? '587', 10),
      secure: process.env.SYSTEM_SMTP_PORT === '465',
      auth: { user: process.env.SYSTEM_SMTP_USER, pass: process.env.SYSTEM_SMTP_PASS },
    });
    await transporter.sendMail({
      // If SYSTEM_SMTP_FROM isn't set, present a generic display name over the
      // system address — never a business name.
      from: process.env.SYSTEM_SMTP_FROM || `${APP_NAME} <${process.env.SYSTEM_SMTP_USER}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    transporter.close();
    return { sent: true };
  } catch (err) {
    console.error('[system-email] send failed', err);
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Generate a numeric verification code of the given length (default 6).
 */
export function generateNumericCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += Math.floor(Math.random() * 10).toString();
  return code;
}

export function verificationCodeEmail(name: string, code: string, action: string): { subject: string; text: string } {
  return {
    subject: `Your verification code: ${code}`,
    text:
      `Hi ${name},\n\n` +
      `Your verification code to ${action} is:\n\n` +
      `    ${code}\n\n` +
      `This code expires in 10 minutes. If you didn't request this, you can ignore this email and your account stays unchanged.\n`,
  };
}
