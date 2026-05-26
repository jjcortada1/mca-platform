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
  // ---- HARD ISOLATION GUARD ----------------------------------------------
  // Each funder MUST receive its own message with exactly ONE address in `to`.
  // No funder may ever appear in another funder's To or CC. This guard makes it
  // structurally impossible to regress into batching, even if a caller passes a
  // comma-joined string or an array by mistake.
  const rawTo = String(input.toEmail ?? '').trim();
  if (!rawTo) {
    return { success: false, error: 'No recipient email provided' };
  }
  // Reject any attempt to smuggle multiple recipients into a single send.
  if (/[,;]/.test(rawTo) || /\s/.test(rawTo.replace(/^[^<]*<|>$/g, ''))) {
    return {
      success: false,
      error: 'Internal: multiple recipients in a single send are not allowed (funder isolation).',
    };
  }
  const toEmail = rawTo;

  // CC list: dedupe, drop empties, and CRITICALLY remove the funder's own address
  // so a funder never appears in their own CC, and strip anything that isn't a
  // plausible email. The CC person(s) get their own copy per funder by design.
  const ccEmails = Array.from(
    new Set(
      (input.ccEmails ?? [])
        .map((e) => String(e ?? '').trim())
        .filter((e) => e && e.includes('@'))
        .filter((e) => e.toLowerCase() !== toEmail.toLowerCase())
    )
  );
  // ------------------------------------------------------------------------

  const transporter = makeTransport(input.smtp);
  try {
    const info = await transporter.sendMail({
      from: input.smtp.from,
      to: toEmail,
      cc: ccEmails.length ? ccEmails : undefined,
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
 * Send the SAME deal to MANY funders, each as a fully isolated message,
 * reusing a single SMTP connection (pooled) for speed and to avoid
 * per-message handshake overhead / provider rate-limits.
 *
 * Isolation guarantee is identical to sendDealEmail: one address in `to`,
 * funder never in their own or anyone else's recipients.
 */
export interface BatchRecipient {
  toEmail: string;
  /** Opaque tag the caller uses to correlate results (e.g. funderId or name). */
  ref: string;
}

export interface BatchSendResult {
  ref: string;
  toEmail: string;
  success: boolean;
  messageId?: string;
  response?: string;
  error?: string;
}

export async function sendDealEmailBatch(
  base: Omit<SendDealEmailInput, 'toEmail'>,
  recipients: BatchRecipient[]
): Promise<BatchSendResult[]> {
  // One pooled transport for the whole batch.
  const password = decrypt(base.smtp.encryptedPass);
  const transporter = nodemailer.createTransport({
    host: base.smtp.host,
    port: base.smtp.port,
    secure: base.smtp.secure ?? base.smtp.port === 465,
    auth: { user: base.smtp.user, pass: password },
    pool: true,
    maxConnections: 1, // serialize — gentle on provider limits, predictable on Replit
    maxMessages: Infinity,
  });

  const out: BatchSendResult[] = [];
  try {
    for (const r of recipients) {
      const rawTo = String(r.toEmail ?? '').trim();
      if (!rawTo) {
        out.push({ ref: r.ref, toEmail: '', success: false, error: 'No recipient email provided' });
        continue;
      }
      if (/[,;]/.test(rawTo)) {
        out.push({ ref: r.ref, toEmail: rawTo, success: false, error: 'Internal: multiple recipients not allowed (funder isolation).' });
        continue;
      }
      const toEmail = rawTo;
      const ccEmails = Array.from(
        new Set(
          (base.ccEmails ?? [])
            .map((e) => String(e ?? '').trim())
            .filter((e) => e && e.includes('@'))
            .filter((e) => e.toLowerCase() !== toEmail.toLowerCase())
        )
      );
      try {
        const info = await transporter.sendMail({
          from: base.smtp.from,
          to: toEmail,
          cc: ccEmails.length ? ccEmails : undefined,
          replyTo: base.replyTo,
          subject: buildSubject(base.dealName),
          text: buildBody(base.bodyNotes, base.structuredFields),
          attachments: base.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        });
        out.push({ ref: r.ref, toEmail, success: true, messageId: info.messageId, response: info.response });
      } catch (err) {
        out.push({ ref: r.ref, toEmail, success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    transporter.close();
  }
  return out;
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
