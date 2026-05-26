import nodemailer from 'nodemailer';

/**
 * System email sender — uses the platform-level SYSTEM_SMTP_* env vars (NOT a
 * user's or company's SMTP). Used for account/security notifications like
 * verification codes and password-reset links.
 *
 * Configure in Replit Secrets:
 *   SYSTEM_SMTP_HOST   e.g. smtp.gmail.com
 *   SYSTEM_SMTP_PORT   e.g. 587
 *   SYSTEM_SMTP_USER   the login (full email)
 *   SYSTEM_SMTP_PASS   app password
 *   SYSTEM_SMTP_FROM   optional "Name <email>"; defaults to SYSTEM_SMTP_USER
 */

export function isSystemEmailConfigured(): boolean {
  return Boolean(process.env.SYSTEM_SMTP_HOST && process.env.SYSTEM_SMTP_USER);
}

export interface SystemEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SystemEmailResult {
  sent: boolean;
  /** In dev (no SMTP configured) we don't send — caller may surface this. */
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
      from: process.env.SYSTEM_SMTP_FROM || process.env.SYSTEM_SMTP_USER,
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
