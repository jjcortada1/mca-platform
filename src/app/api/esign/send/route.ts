import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { esignConfig, esignRequests, users, companies } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { sendGenericEmail, type SmtpConfig } from '@/lib/email/smtp';
import { titleCaseName } from '@/lib/utils';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_BODY =
  'Here is a link to our application. Please complete it ASAP so I can get working on your file now.';

/** GET — recent application sends for this company (newest first). */
export async function GET() {
  try {
    const ctx = await requirePermission('deals.submit');
    const rows = await db
      .select({
        id: esignRequests.id,
        recipientName: esignRequests.recipientName,
        recipientEmail: esignRequests.recipientEmail,
        status: esignRequests.status,
        createdAt: esignRequests.createdAt,
        applicationUrl: esignRequests.applicationUrl,
        createdBy: esignRequests.createdBy,
        senderName: users.name,
      })
      .from(esignRequests)
      .leftJoin(users, eq(users.id, esignRequests.createdBy))
      .where(eq(esignRequests.companyId, ctx.companyId))
      .orderBy(desc(esignRequests.createdAt))
      .limit(50);
    return NextResponse.json({ data: rows });
  } catch (e) { return apiError(e); }
}

const sendSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  message: z.string().max(2000).optional().nullable(),
});

/**
 * POST — email someone the LINK to the application.
 *
 * Subject: "<Company name> Application" (e.g. "Cortada Capital Group Application").
 * Body:    Hi <first name>,
 *          <saved body from Settings — default asks them to complete it ASAP>
 *          <application link>
 *          (+ the rep's optional personal note, and their signature)
 * Sent through the same SMTP the rep shops deals with.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('deals.submit');
    const body = sendSchema.parse(await req.json());

    const [cfg] = await db.select().from(esignConfig)
      .where(eq(esignConfig.companyId, ctx.companyId)).limit(1);
    if (!cfg?.applicationUrl) {
      return NextResponse.json(
        { error: 'No application link is set up yet. An admin needs to add it in Settings → Application link.' },
        { status: 400 },
      );
    }

    // Resolve SMTP exactly like deal submissions: shared company account or
    // the sender's own connected account.
    const [company] = await db.select().from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    let smtp: SmtpConfig | null = null;
    const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (company.emailMode === 'shared') {
      smtp = (company.smtpConfig as SmtpConfig | null) ?? null;
    } else {
      smtp = (me?.smtpConfig as SmtpConfig | null) ?? null;
    }
    if (!smtp) {
      return NextResponse.json(
        { error: company.emailMode === 'per_rep'
          ? 'Your email account isn\'t connected yet — set it up under Settings → My account → My email SMTP.'
          : 'Email is not configured for the company yet. Ask an admin to set up SMTP in Settings.' },
        { status: 400 },
      );
    }

    const firstName = titleCaseName(body.name.trim().split(/\s+/)[0] || body.name.trim());
    const savedBody = (cfg.emailBody?.trim() || DEFAULT_BODY);
    const note = body.message?.trim();
    const emailText = [
      `Hi ${firstName},`,
      '',
      savedBody,
      '',
      cfg.applicationUrl,
      ...(note ? ['', note] : []),
    ].join('\n');

    const signature = (me?.emailSignature || me?.signatureLogoUrl || me?.signatureLink)
      ? { text: me.emailSignature ?? '', logoDataUri: me.signatureLogoUrl ?? null, link: me.signatureLink ?? null }
      : null;

    const result = await sendGenericEmail({
      smtp,
      toEmail: body.email.trim().toLowerCase(),
      ccEmails: [],
      subject: `${company.name} Application`,
      bodyNotes: emailText,
      structuredFields: [],
      attachments: [],
      signature,
    });
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'The email could not be sent.' }, { status: 502 });
    }

    const [row] = await db.insert(esignRequests).values({
      companyId: ctx.companyId,
      recipientName: titleCaseName(body.name.trim()),
      recipientEmail: body.email.trim().toLowerCase(),
      signatureRequestId: null,
      // Snapshot the exact link that was emailed so it stays copyable on
      // the record even if the company link changes later.
      applicationUrl: cfg.applicationUrl,
      status: 'sent',
      createdBy: ctx.user.id,
    }).returning();

    return NextResponse.json({ ok: true, data: row });
  } catch (e) { return apiError(e); }
}
