/**
 * SMTP Email Sending
 *
 * Critical behaviors:
 *   - Each funder gets a SEPARATE email message (separate Message-ID, no shared threads).
 *   - No funder is in the To/CC of another funder's email.
 *   - CC list = per-submission CCs ∪ company-level globalCcEmails.
 *   - Attachments are passed through from request memory to SMTP — never persisted.
 *   - Structured fields render into the body deterministically.
 */

import nodemailer, { Transporter } from 'nodemailer';
import { decrypt } from '@/lib/crypto';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  // When stored encrypted at rest, this field is the encrypted blob.
  encryptedPass: string;
  from: string; // "Name <email@example.com>"
  secure?: boolean; // defaults: true if port 465, else false (STARTTLS)
}

export interface EmailAttachment {
  filename: string;
  content: Buffer; // raw file bytes from upload
  contentType?: string;
}

export interface StructuredField {
  label: string;
  value: string;
}

export interface SendDealEmailInput {
  smtp: SmtpConfig;
  toEmail: string;
  ccEmails: string[];
  dealName: string;
  bodyNotes: string;
  structuredFields: StructuredField[];
  attachments: EmailAttachment[];
  replyTo?: string;
}

export interface SendDealEmailResult {
  success: boolean;
  messageId?: string;
  response?: string;
  error?: string;
}

function buildBody(notes: string, fields: StructuredField[]): string {
  const lines: string[] = [];
  if (fields.length) {
    for (const f of fields) {
      if (f.value && f.value.trim()) {
        lines.push(`${f.label}: ${f.value}`);
      }
    }
    lines.push('');
  }
  if (notes && notes.trim()) {
    lines.push(notes.trim());
  }
  return lines.join('\n');
}

function buildSubject(dealName: string): string {
  return `NEW DEAL | ${dealName}`;
}

function makeTransport(smtp: SmtpConfig): Transporter {
  const password = decrypt(smtp.encryptedPass);
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? smtp.port === 465,
    auth: { user: smtp.user, pass: password },
  });
}

export async function sendDealEmail(input: SendDealEmailInput): Promise<SendDealEmailResult> {
  const transporter = makeTransport(input.smtp);
  try {
    const info = await transporter.sendMail({
      from: input.smtp.from,
      to: input.toEmail,
      cc: input.ccEmails.length ? input.ccEmails : undefined,
      replyTo: input.replyTo,
      subject: buildSubject(input.dealName),
      text: buildBody(input.bodyNotes, input.structuredFields),
      attachments: input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
      // No In-Reply-To, no References — every send to a different funder is its own thread.
    });
    return { success: true, messageId: info.messageId, response: info.response };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    transporter.close();
  }
}

/**
 * Verify SMTP credentials (used when admin saves SMTP config in Settings).
 */
export async function verifySmtp(smtp: SmtpConfig): Promise<{ ok: boolean; error?: string }> {
  const transporter = makeTransport(smtp);
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    transporter.close();
  }
}
