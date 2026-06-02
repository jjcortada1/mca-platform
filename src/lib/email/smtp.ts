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

/**
 * Rich signature data. When present, emails are sent as multipart with both
 * a plain-text body (for clients that don't render HTML) AND an HTML body
 * that includes the inline logo + clickable link.
 *
 * The logo (if any) is sent as a CID-referenced attachment so it renders
 * inline in Gmail/Outlook without an external image fetch.
 */
export interface SignatureBlock {
  /** Plain text — included in BOTH the text and html versions. */
  text: string;
  /** Optional inline logo as a data URI ("data:image/png;base64,..."). */
  logoDataUri?: string | null;
  /** Optional click-through URL (http/https). Wraps the logo + adds a link line. */
  link?: string | null;
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
  /** When provided, the body is sent as multipart text + HTML. */
  signature?: SignatureBlock | null;
}

export interface SendDealEmailResult {
  success: boolean;
  messageId?: string;
  response?: string;
  error?: string;
}

/**
 * Escape user-controlled text for inclusion inside HTML. Used when building
 * the multipart HTML version of an email body. Without this, a rep typing
 * "<script>" into their signature would actually send live script tags to
 * the recipient (whose mail client might render them).
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Turn URLs in a block of text into clickable <a> tags for the HTML version.
 * Same idea as the in-app linkify helper but operates AFTER escapeHtml so
 * angle brackets in adjacent text are already neutralized.
 *
 * Only http/https — never javascript:, mailto:, data:, etc. — to keep the
 * HTML safe even if the sender's signature text contained something hostile.
 */
function htmlAutolink(escapedHtml: string): string {
  // After escapeHtml, "https://x" stays intact; we wrap it in an anchor.
  return escapedHtml.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
}

/**
 * Build the plain-text version of the body. Used for both text-only sends
 * and as the text/plain part of multipart messages.
 *
 * Layout:
 *   Label: value          ← one per line, stacked vertically
 *   Label: value
 *
 *   {notes}               ← optional free-text
 *
 *   --                    ← RFC 3676 signature delimiter
 *   {signature text}      ← rep's signature lines
 *   {link}                ← if signature has a link, the URL on its own line
 *
 * The text version intentionally does NOT include the logo (it's text-only).
 */
function buildPlainTextBody(
  notes: string,
  fields: StructuredField[],
  signature: SignatureBlock | null | undefined,
): string {
  const lines: string[] = [];
  if (fields.length) {
    for (const f of fields) {
      if (f.value && f.value.trim()) {
        lines.push(`${f.label}: ${f.value}`);
      }
    }
    lines.push('');
  }
  if (notes && notes.trim()) lines.push(notes.trim());
  // Signature appended after a single blank line — no "--" divider per
  // user spec ("remove that line"). The signature reads as a continuation
  // of the message body, not as a visually separate block.
  if (signature && (signature.text?.trim() || signature.link)) {
    lines.push('');
    if (signature.text?.trim()) lines.push(signature.text.trim());
    if (signature.link) lines.push(signature.link);
  }
  return lines.join('\n');
}

/**
 * Build the HTML version of the body. Uses <pre> for the deal info so the
 * Label: value alignment stays as the user typed it. Signature gets its own
 * styled block with the inline logo (if any) and a clickable link.
 *
 * The inline logo is referenced via `cid:signature-logo` so the email client
 * fetches it from the attached binary, not from the public internet.
 */
function buildHtmlBody(
  notes: string,
  fields: StructuredField[],
  signature: SignatureBlock | null | undefined,
  logoCid: string | null,
): string {
  const parts: string[] = [];
  // Outer wrapper: no font-family override so the email body uses whatever
  // font the recipient's mail client uses by default (the same font the
  // sender's signature was composed in renders the same way on receive).
  // No color override either — that way auto-linked URLs in the signature
  // (which inherit color via the rules below) match the surrounding text
  // instead of going blue.
  parts.push('<div style="font-size:14px; line-height:1.55;">');

  if (fields.length) {
    const inner = fields
      .filter((f) => f.value && f.value.trim())
      .map((f) => `<div><strong>${escapeHtml(f.label)}:</strong> ${htmlAutolink(escapeHtml(f.value))}</div>`)
      .join('');
    if (inner) parts.push(`<div style="margin-bottom:16px;">${inner}</div>`);
  }

  if (notes && notes.trim()) {
    // Convert typed newlines into <br> ONLY (no white-space:pre-wrap). Using
    // both at once was producing double line breaks — pre-wrap preserved the
    // original \n AND the <br> rendered as a separate break, so every line
    // got an extra blank one. <br> alone gives a clean single break that
    // matches exactly what the user typed.
    const notesEsc = htmlAutolink(escapeHtml(notes.trim())).replace(/\n/g, '<br>');
    parts.push(`<div style="margin-bottom:16px;">${notesEsc}</div>`);
  }

  // Signature block — no top border / divider. The signature flows directly
  // after the notes, separated only by a small margin so it reads as one
  // continuous message. Auto-linked text uses `color:inherit` so a URL
  // inside the signature stays the surrounding color instead of going blue.
  if (signature && (signature.text?.trim() || logoCid || signature.link)) {
    parts.push('<div style="margin-top:16px; font-size:13px;">');
    if (signature.text?.trim()) {
      // Same \n → <br> approach as notes. Anchors inside the signature get
      // `color:inherit; text-decoration:none` so the rep's contact info
      // doesn't render as blue links — it looks like the signature text
      // they typed but is still clickable.
      const sigEsc = htmlAutolink(escapeHtml(signature.text.trim()))
        .replace(/\n/g, '<br>')
        .replace(/<a /g, '<a style="color:inherit; text-decoration:none;" ');
      parts.push(`<div>${sigEsc}</div>`);
    }
    if (logoCid) {
      const img = `<img src="cid:${logoCid}" alt="" style="max-height:60px; max-width:240px; display:block; margin:8px 0; border:0;" />`;
      // Wrap the logo in the link, if provided.
      if (signature.link) {
        parts.push(`<a href="${escapeHtml(signature.link)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; color:inherit; text-decoration:none;">${img}</a>`);
      } else {
        parts.push(img);
      }
    }
    if (signature.link && !logoCid) {
      // Link-only (no logo) — render as a plain anchor that inherits color.
      parts.push(`<div style="margin-top:6px;"><a href="${escapeHtml(signature.link)}" target="_blank" rel="noopener noreferrer" style="color:inherit; text-decoration:none;">${escapeHtml(signature.link)}</a></div>`);
    }
    parts.push('</div>');
  }

  parts.push('</div>');
  return parts.join('');
}

/**
 * Extract the bytes + content type from a data URI, for use as a CID inline
 * attachment. Returns null if the data URI is unusable (wrong shape, etc.).
 */
function dataUriToInline(dataUri: string, cid: string): EmailAttachment & { cid: string } | null {
  const m = dataUri.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const mime = m[1];
  const buf = Buffer.from(m[2], 'base64');
  // Be defensive about size — reject anything obviously too big for an
  // inline signature graphic. 600KB is generous; most logos are under 50KB.
  if (buf.length > 600 * 1024) return null;
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  return {
    filename: `signature-logo.${ext}`,
    content: buf,
    contentType: mime,
    cid,
  };
}

function buildBody(notes: string, fields: StructuredField[]): string {
  // Kept for back-compat with callers that don't pass a signature block.
  return buildPlainTextBody(notes, fields, null);
}

function buildSubject(dealName: string): string {
  // Plain "New Deal - {dealName}". Per-recipient thread-breaking is handled
  // with an invisible disambiguator appended at send time, not visible text.
  return `New Deal - ${dealName}`;
}

/**
 * Gmail (and Outlook's "Conversation View") collapse messages whose subjects
 * match exactly into a single thread on the sender's side. We don't want that
 * for shopping emails — each funder should appear as its own conversation.
 *
 * Solution: append zero-width characters that are invisible to the human eye
 * but make each subject technically unique, defeating exact-subject grouping
 * without uglifying the subject the recipient sees.
 *
 * `seed` should be unique per recipient (e.g. the funderId or the recipient
 * email). We encode it as a deterministic sequence of zero-width joiner /
 * non-joiner characters appended to the subject.
 */
function applyThreadBreaker(subject: string, seed: string): string {
  // Two invisible chars: zero-width-non-joiner (U+200C) and zero-width-joiner (U+200D).
  // Encode a hash of the seed as binary across these two characters.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  // 16 invisible chars carry enough entropy to make each recipient unique.
  let suffix = '';
  for (let i = 0; i < 16; i++) {
    suffix += ((hash >> i) & 1) ? '\u200D' : '\u200C';
    if ((i & 7) === 7) hash = (hash * 131 + 7) >>> 0;
  }
  return subject + suffix;
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
  // Header injection: CR/LF in any header value can split the message and add
  // BCC, From, etc. Reject hard. Same applies to NUL.
  if (/[\r\n\0]/.test(rawTo)) {
    return { success: false, error: 'Invalid recipient address.' };
  }
  // Reject any attempt to smuggle multiple recipients into a single send.
  if (/[,;]/.test(rawTo) || /\s/.test(rawTo.replace(/^[^<]*<|>$/g, ''))) {
    return {
      success: false,
      error: 'Internal: multiple recipients in a single send are not allowed (funder isolation).',
    };
  }
  // Sanity check the email shape.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawTo)) {
    return { success: false, error: 'Recipient email is not a valid address.' };
  }
  const toEmail = rawTo;

  // CC list: dedupe, drop empties, and CRITICALLY remove the funder's own address
  // so a funder never appears in their own CC, and strip anything that isn't a
  // plausible email. Also reject any CC value that smuggles CR/LF.
  const ccEmails = Array.from(
    new Set(
      (input.ccEmails ?? [])
        .map((e) => String(e ?? '').trim())
        .filter((e) => e && e.includes('@'))
        .filter((e) => !/[\r\n\0]/.test(e))
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
        .filter((e) => e.toLowerCase() !== toEmail.toLowerCase())
    )
  );
  // ------------------------------------------------------------------------

  const transporter = makeTransport(input.smtp);
  try {
    // Build text + (optionally) HTML versions. When a signature is provided
    // we send multipart so the logo + clickable link render in HTML clients
    // while plain-text clients still get a readable signature.
    const sig = input.signature ?? null;
    const text = buildPlainTextBody(input.bodyNotes, input.structuredFields, sig);

    let html: string | undefined;
    const inlineAttachments: { filename: string; content: Buffer; contentType?: string; cid: string }[] = [];

    if (sig) {
      let logoCid: string | null = null;
      if (sig.logoDataUri) {
        const cid = `signature-logo-${Date.now()}`;
        const inline = dataUriToInline(sig.logoDataUri, cid);
        if (inline) {
          inlineAttachments.push(inline);
          logoCid = cid;
        }
      }
      html = buildHtmlBody(input.bodyNotes, input.structuredFields, sig, logoCid);
    }

    const info = await transporter.sendMail({
      from: input.smtp.from,
      to: toEmail,
      cc: ccEmails.length ? ccEmails : undefined,
      replyTo: input.replyTo,
      subject: buildSubject(input.dealName),
      text,
      html,
      attachments: [
        ...input.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
        ...inlineAttachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          cid: a.cid,
        })),
      ],
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
/**
 * Per-funder isolated send. The `toEmails` array carries ALL of one funder's
 * submission addresses so they ride on a single email (one thread per funder).
 * Different funders STILL get separate messages — no funder appears in
 * another funder's recipient list.
 */
export interface BatchRecipient {
  /**
   * All addresses for this ONE funder. If a funder has multiple submission
   * emails (e.g. submissions@x.com + deals@x.com), they all go into the
   * To: header of a single message so the funder sees one thread.
   * The legacy `toEmail` single-string field is accepted as a fallback.
   */
  toEmails?: string[];
  toEmail?: string;
  /** Opaque tag the caller uses to correlate results (e.g. funderId or name). */
  ref: string;
  /**
   * Optional label appended to the subject for this recipient so each email
   * ends up in its own conversation thread on the sender's side (Gmail
   * threads by exact subject match). Typically the funder name. If omitted,
   * we fall back to the local-part of the first recipient address.
   */
  label?: string;
}

export interface BatchSendResult {
  ref: string;
  /** All addresses this email went to (one funder may have several). */
  toEmails: string[];
  /** Convenience: first address from toEmails (back-compat with old callers). */
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
      // Normalize the recipient: accept the new toEmails array OR the legacy
      // single toEmail string. All addresses for one funder go into the SAME
      // outgoing message's To: header.
      const rawList = (r.toEmails && r.toEmails.length) ? r.toEmails : (r.toEmail ? [r.toEmail] : []);
      const addresses: string[] = [];
      let badAddress: string | null = null;
      for (const addr of rawList) {
        const v = String(addr ?? '').trim();
        if (!v) continue;
        // Each address gets the same hard validation as the single-address path.
        if (/[\r\n\0]/.test(v)) { badAddress = `Invalid recipient address: header chars`; break; }
        if (/[,;]/.test(v)) { badAddress = `Address contains comma/semicolon: ${v}`; break; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { badAddress = `Not a valid email: ${v}`; break; }
        if (!addresses.find((x) => x.toLowerCase() === v.toLowerCase())) addresses.push(v);
      }
      if (badAddress) {
        out.push({ ref: r.ref, toEmails: rawList, toEmail: rawList[0] ?? '', success: false, error: badAddress });
        continue;
      }
      if (addresses.length === 0) {
        out.push({ ref: r.ref, toEmails: [], toEmail: '', success: false, error: 'No recipient email provided' });
        continue;
      }

      // CC list — strip anything that's in the To list to avoid double delivery,
      // and dedupe / validate as before.
      const toLower = new Set(addresses.map((a) => a.toLowerCase()));
      const ccEmails = Array.from(
        new Set(
          (base.ccEmails ?? [])
            .map((e) => String(e ?? '').trim())
            .filter((e) => e && e.includes('@'))
            .filter((e) => !/[\r\n\0]/.test(e))
            .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
            .filter((e) => !toLower.has(e.toLowerCase()))
        )
      );

      // Clean subject. Invisible per-recipient disambiguator appended to defeat
      // Gmail's same-subject conversation grouping without uglifying the subject.
      // We tag with the FUNDER ref (not individual address), so all addresses
      // for one funder share the same subject = one thread for that funder.
      const cleanSubject = buildSubject(base.dealName);
      const subjectForSend = applyThreadBreaker(cleanSubject, `${r.ref}|${addresses[0]}`);

      // Build text + (optional) HTML body. When the sender has a signature we
      // send multipart. The logo is inlined as a CID attachment per message so
      // it renders in Gmail/Outlook without needing an external image fetch.
      const sig = base.signature ?? null;
      const text = buildPlainTextBody(base.bodyNotes, base.structuredFields, sig);
      let html: string | undefined;
      const inlineAttachments: { filename: string; content: Buffer; contentType?: string; cid: string }[] = [];
      if (sig) {
        let logoCid: string | null = null;
        if (sig.logoDataUri) {
          // Unique CID per recipient to avoid any chance of clients caching
          // the wrong image when the same transport handles multiple sends.
          const cid = `signature-logo-${Date.now()}-${r.ref.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`;
          const inline = dataUriToInline(sig.logoDataUri, cid);
          if (inline) {
            inlineAttachments.push(inline);
            logoCid = cid;
          }
        }
        html = buildHtmlBody(base.bodyNotes, base.structuredFields, sig, logoCid);
      }

      try {
        const info = await transporter.sendMail({
          from: base.smtp.from,
          // All of this funder's addresses ride on one message. nodemailer
          // accepts an array of strings here and writes them comma-joined
          // into the To: header.
          to: addresses,
          cc: ccEmails.length ? ccEmails : undefined,
          replyTo: base.replyTo,
          subject: subjectForSend,
          text,
          html,
          attachments: [
            ...base.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            })),
            ...inlineAttachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
              cid: a.cid,
            })),
          ],
          // Defensively make sure no reply/reference header sneaks in from
          // pooled transport state. Each message stands on its own.
          inReplyTo: undefined,
          references: undefined,
        });
        out.push({ ref: r.ref, toEmails: addresses, toEmail: addresses[0], success: true, messageId: info.messageId, response: info.response });
      } catch (err) {
        out.push({ ref: r.ref, toEmails: addresses, toEmail: addresses[0], success: false, error: err instanceof Error ? err.message : String(err) });
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

/**
 * Generic single-recipient send. Used by the funded-email flow (and any
 * future one-off notifications). Differences from sendDealEmail:
 *   - Subject is whatever the caller passed (no "New Deal -" prefix).
 *   - No invisible thread-breaker (single recipient, doesn't matter).
 *   - No funder-isolation rules (not a shopping path).
 *   - The body is built from the same Label: value stacked-vertical format.
 *
 * All the security guards stay: CR/LF/NUL rejection, email regex check,
 * filename sanitization. These are non-negotiable for any send path.
 */
export interface SendGenericEmailInput {
  smtp: SmtpConfig;
  toEmail: string;
  ccEmails: string[];
  subject: string;
  bodyNotes: string;
  structuredFields: StructuredField[];
  attachments: EmailAttachment[];
  replyTo?: string;
  /**
   * Rich signature. Same shape as the deal-email path. If provided, the
   * message is sent as multipart text + HTML so the logo + clickable link
   * render in modern clients.
   */
  signature?: SignatureBlock | null;
}

export async function sendGenericEmail(input: SendGenericEmailInput): Promise<SendDealEmailResult> {
  const rawTo = String(input.toEmail ?? '').trim();
  if (!rawTo) return { success: false, error: 'No recipient email provided' };
  if (/[\r\n\0]/.test(rawTo)) return { success: false, error: 'Invalid recipient address.' };
  if (/[,;]/.test(rawTo)) return { success: false, error: 'Multiple recipients not allowed.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawTo)) {
    return { success: false, error: 'Recipient email is not a valid address.' };
  }
  const toEmail = rawTo;

  const ccEmails = Array.from(
    new Set(
      (input.ccEmails ?? [])
        .map((e) => String(e ?? '').trim())
        .filter((e) => e && e.includes('@'))
        .filter((e) => !/[\r\n\0]/.test(e))
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
        .filter((e) => e.toLowerCase() !== toEmail.toLowerCase())
    )
  );

  // Defensive header check on subject
  const rawSubject = String(input.subject ?? '').trim();
  if (/[\r\n\0]/.test(rawSubject)) {
    return { success: false, error: 'Invalid subject.' };
  }
  const subject = rawSubject || '(no subject)';

  // Build text + HTML versions. When the rep has a signature with a logo
  // we send multipart; otherwise text-only is fine.
  const sig = input.signature ?? null;
  const text = buildPlainTextBody(input.bodyNotes, input.structuredFields, sig);

  let html: string | undefined;
  const inlineAttachments: { filename: string; content: Buffer; contentType?: string; cid: string }[] = [];
  if (sig) {
    let logoCid: string | null = null;
    if (sig.logoDataUri) {
      const cid = `signature-logo-${Date.now()}`;
      const inline = dataUriToInline(sig.logoDataUri, cid);
      if (inline) {
        inlineAttachments.push(inline);
        logoCid = cid;
      }
    }
    html = buildHtmlBody(input.bodyNotes, input.structuredFields, sig, logoCid);
  }

  const transporter = makeTransport(input.smtp);
  try {
    const info = await transporter.sendMail({
      from: input.smtp.from,
      to: toEmail,
      cc: ccEmails.length ? ccEmails : undefined,
      replyTo: input.replyTo || undefined,
      subject,
      text,
      html,
      attachments: [
        ...input.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
        ...inlineAttachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          cid: a.cid,
        })),
      ],
      inReplyTo: undefined,
      references: undefined,
    });
    return { success: true, messageId: info.messageId, response: info.response };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    transporter.close();
  }
}
