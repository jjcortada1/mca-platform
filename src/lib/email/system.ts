import nodemailer from 'nodemailer';

/**
 * System email sender for ACCOUNT/SECURITY emails: verification codes and
 * password-reset links.
 *
 * Transport priority:
 *   1. Resend (recommended) — set RESEND_API_KEY + EMAIL_FROM.
 *      Professional sender (e.g. noreply@yourdomain.com), great deliverability,
 *      one account serves ALL companies. Never tied to a personal Gmail.
 *   2. SMTP (SYSTEM_SMTP_*) — fallback if you'd rather use an SMTP account.
 *   3. Dev fallback — logs to console so flows are testable with nothing set up.
 *
 * These emails are SENT from the platform sender and DELIVERED to the user's
 * normal login email. Users never need to configure anything to RECEIVE a code.
 *
 * Configure in Replit Secrets (Resend path — recommended):
 *   RESEND_API_KEY   re_xxxxx  (from resend.com)
 *   EMAIL_FROM       "Account Security <noreply@yourdomain.com>"
 *
 * Or the SMTP path:
 *   SYSTEM_SMTP_HOST / SYSTEM_SMTP_PORT / SYSTEM_SMTP_USER / SYSTEM_SMTP_PASS / SYSTEM_SMTP_FROM
 */

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SYSTEM_SMTP_HOST && process.env.SYSTEM_SMTP_USER);
}

export function isSystemEmailConfigured(): boolean {
  return isResendConfigured() || isSmtpConfigured();
}

/**
 * Display name used inside security emails (subjects/bodies). Generic by default
 * so it isn't tied to any business name. Override with APP_NAME in Secrets.
 */
export const APP_NAME = process.env.APP_NAME || 'Account Security';

export interface SystemEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SystemEmailResult {
  sent: boolean;
  /** Which transport sent it. */
  via?: 'resend' | 'smtp';
  /** In dev (nothing configured) we don't send — caller may surface this. */
  dev?: boolean;
  error?: string;
}

/** Resolve the "From" header for whichever transport is active. */
function resolveFrom(): string {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  if (process.env.SYSTEM_SMTP_FROM) return process.env.SYSTEM_SMTP_FROM;
  if (process.env.SYSTEM_SMTP_USER) return `${APP_NAME} <${process.env.SYSTEM_SMTP_USER}>`;
  return `${APP_NAME} <noreply@example.com>`;
}

async function sendViaResend(input: SystemEmailInput): Promise<SystemEmailResult> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resolveFrom(),
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[system-email] Resend error', res.status, detail);
      return { sent: false, via: 'resend', error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true, via: 'resend' };
  } catch (err) {
    console.error('[system-email] Resend send failed', err);
    return { sent: false, via: 'resend', error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendViaSmtp(input: SystemEmailInput): Promise<SystemEmailResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SYSTEM_SMTP_HOST,
      port: parseInt(process.env.SYSTEM_SMTP_PORT ?? '587', 10),
      secure: process.env.SYSTEM_SMTP_PORT === '465',
      auth: { user: process.env.SYSTEM_SMTP_USER, pass: process.env.SYSTEM_SMTP_PASS },
    });
    await transporter.sendMail({
      from: resolveFrom(),
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    transporter.close();
    return { sent: true, via: 'smtp' };
  } catch (err) {
    console.error('[system-email] SMTP send failed', err);
    return { sent: false, via: 'smtp', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendSystemEmail(input: SystemEmailInput): Promise<SystemEmailResult> {
  // 1) Prefer Resend
  if (isResendConfigured()) {
    return sendViaResend(input);
  }
  // 2) Fall back to SMTP
  if (isSmtpConfigured()) {
    return sendViaSmtp(input);
  }
  // 3) Dev fallback: log so flows are testable without any email account.
  console.log(`[DEV system-email] To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}`);
  return { sent: false, dev: true };
}

/**
 * Lightweight connectivity check used by the "Send test email" button.
 * Returns which transport is active (or none).
 */
export function activeEmailTransport(): 'resend' | 'smtp' | 'none' {
  if (isResendConfigured()) return 'resend';
  if (isSmtpConfigured()) return 'smtp';
  return 'none';
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
