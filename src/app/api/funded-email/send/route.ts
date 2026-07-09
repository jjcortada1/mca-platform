import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users, companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import {
  sendGenericEmail, type EmailAttachment, type SmtpConfig, type StructuredField,
} from '@/lib/email/smtp';

export const runtime = 'nodejs';

/**
 * POST /api/funded-email/send
 *
 * Sends a single "funded" email using the admin-defined template.
 *
 * Form-data fields (multipart/form-data):
 *   toEmail   string         single recipient
 *   ccEmails  JSON string    optional array of CC addresses (rep-chosen only —
 *                            global CC and always-CC are intentionally NOT applied)
 *   subject   string         pre-rendered subject (rep may have substituted placeholders)
 *   fields    JSON string    array of { label, value }
 *   notes     string         optional free-text notes appended after the structured fields
 *   (file attachments)       any other multipart File entries are sent as attachments
 *
 * Differences from /api/submissions/send:
 *   - Single recipient (not the funder-batch fan-out).
 *   - The rep's "always CC" is NOT applied — explicit per spec.
 *   - Subject comes from the funded template (set by admin), not "New Deal -".
 *   - Signature IS appended (same as submissions).
 *   - Reuses the same attachment guards (25MB/file, 50MB total, 30 count,
 *     filename sanitization).
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_ATTACHMENTS = 30;

function sanitizeFilename(raw: string): string {
  let name = String(raw ?? '').trim();
  name = name.replace(/[\r\n\0]/g, '');
  name = name.replace(/[/\\]/g, '_');
  name = name.replace(/^\.+/, '');
  if (name.length > 200) name = name.slice(0, 200);
  return name || 'attachment';
}

export async function POST(req: NextRequest) {
  try {
    // Same gate + throttle as /api/submissions/send — this endpoint sends
    // outbound mail through the rep/company SMTP account, so a bare session
    // must not be enough.
    const ctx = await requirePermission('deals.submit');
    const rl = rateLimit(`send:${ctx.user.id}`, { max: 20, windowMs: 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many sends. Try again in ${rl.retryAfterSec}s.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const fd = await req.formData();
    const toEmail = String(fd.get('toEmail') ?? '').trim();
    const subject = String(fd.get('subject') ?? '').trim();
    const notes = String(fd.get('notes') ?? '');
    const fieldsRaw = String(fd.get('fields') ?? '[]');
    const ccRaw = String(fd.get('ccEmails') ?? '[]');

    if (!toEmail) return NextResponse.json({ error: 'Recipient email is required.' }, { status: 400 });
    if (!subject) return NextResponse.json({ error: 'Subject is required.' }, { status: 400 });

    let structuredFields: StructuredField[];
    let ccEmails: string[];
    try {
      structuredFields = JSON.parse(fieldsRaw);
      ccEmails = JSON.parse(ccRaw);
    } catch {
      return NextResponse.json({ error: 'Invalid fields or ccEmails JSON.' }, { status: 400 });
    }
    if (!Array.isArray(structuredFields) || !Array.isArray(ccEmails)) {
      return NextResponse.json({ error: 'fields and ccEmails must be arrays.' }, { status: 400 });
    }

    // Attachments: same caps as the submissions path.
    const attachments: EmailAttachment[] = [];
    let totalBytes = 0;
    for (const [, value] of Array.from(fd.entries())) {
      if (value instanceof File) {
        if (value.size > MAX_FILE_BYTES) {
          return NextResponse.json({ error: `Attachment "${value.name}" is too large (>25MB).` }, { status: 413 });
        }
        totalBytes += value.size;
        if (totalBytes > MAX_TOTAL_BYTES) {
          return NextResponse.json({ error: 'Total attachment size exceeds 50MB.' }, { status: 413 });
        }
        if (attachments.length >= MAX_ATTACHMENTS) {
          return NextResponse.json({ error: `Max ${MAX_ATTACHMENTS} attachments` }, { status: 400 });
        }
        const buf = Buffer.from(await value.arrayBuffer());
        attachments.push({
          filename: sanitizeFilename(value.name),
          content: buf,
          contentType: value.type || undefined,
        });
      }
    }

    // Resolve SMTP using same rules as the submissions path.
    const [company] = await db.select().from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    let smtp: SmtpConfig | null = null;
    if (company.emailMode === 'shared') {
      smtp = (company.smtpConfig as SmtpConfig | null) ?? null;
    } else {
      const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      smtp = (me?.smtpConfig as SmtpConfig | null) ?? null;
    }
    if (!smtp) {
      return NextResponse.json(
        { error: 'No SMTP configured. Configure it in Settings or My Account.' },
        { status: 400 }
      );
    }

    // Sender's signature with optional logo and link — built into the email
    // body as both text and HTML (multipart). The logo is sent inline via CID.
    const [sender] = await db
      .select({
        emailSignature: users.emailSignature,
        signatureLogoUrl: users.signatureLogoUrl,
        signatureLink: users.signatureLink,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    const signature = (sender?.emailSignature || sender?.signatureLogoUrl || sender?.signatureLink)
      ? {
          text: sender.emailSignature ?? '',
          logoDataUri: sender.signatureLogoUrl ?? null,
          link: sender.signatureLink ?? null,
        }
      : null;

    // IMPORTANT: per spec, the sender's "always CC" does NOT apply to funded
    // emails. Only the rep-typed CC list (and nothing else) is used. The
    // company-wide globalCcEmails is also NOT applied for the same reason —
    // funded emails are personal communications, not deal-shopping fan-out.
    const result = await sendGenericEmail({
      smtp,
      toEmail,
      ccEmails,
      subject,
      bodyNotes: notes,
      structuredFields,
      attachments,
      signature,
    });

    if (!result.success) {
      return NextResponse.json({ ok: false, error: result.error || 'Send failed.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, messageId: result.messageId ?? null });
  } catch (e) {
    return apiError(e);
  }
}
