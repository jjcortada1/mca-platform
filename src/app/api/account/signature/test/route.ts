import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users, companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { resolveMailbox } from '@/lib/email/mailbox';
import { sendGenericEmail, type SmtpConfig } from '@/lib/email/smtp';
import { rateLimit } from '@/lib/api/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/account/signature/test — email the caller a sample message
 * (formatted exactly like a deal submission) so they can see their
 * signature the way recipients will. Uses the same SMTP resolution as
 * real deal sends: company shared account or the rep's own.
 */
export async function POST() {
  try {
    const ctx = await requireTenantContext();
    const rl = rateLimit(`sig-test:${ctx.user.id}`, { max: 5, windowMs: 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many test emails. Try again in ${rl.retryAfterSec}s.` },
        { status: 429 }
      );
    }

    const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    if (!me) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const [company] = await db.select().from(companies).where(eq(companies.id, ctx.companyId)).limit(1);

    let smtp: SmtpConfig | null = null;
    if (company?.emailMode === 'shared') {
      smtp = (company.smtpConfig as SmtpConfig | null) ?? null;
    } else {
      smtp = (me.smtpConfig as SmtpConfig | null) ?? null;
    }
    /* A connected Gmail mailbox is a valid transport on its own, so it is
       resolved BEFORE the SMTP guard — otherwise a rep who connected Gmail
       and never configured SMTP would be told to set up SMTP. */
    const mailbox = await resolveMailbox(ctx.user.id);
    const gmail = mailbox
      ? { accessToken: mailbox.accessToken, from: mailbox.displayName ? `${mailbox.displayName} <${mailbox.emailAddress}>` : mailbox.emailAddress }
      : null;

    if (!smtp && !gmail) {
      return NextResponse.json(
        { error: 'No email account is connected yet — connect Gmail or set up SMTP in My Account, then send the test.' },
        { status: 400 }
      );
    }

    const signature = (me.emailSignature || me.signatureLogoUrl || me.signatureLink)
      ? {
          text: me.emailSignature ?? '',
          logoDataUri: me.signatureLogoUrl ?? null,
          link: me.signatureLink ?? null,
        }
      : null;
    if (!signature) {
      return NextResponse.json(
        { error: 'Save a signature first, then send the test.' },
        { status: 400 }
      );
    }

    const result = await sendGenericEmail({
      gmail,
      smtp,
      toEmail: me.email,
      ccEmails: [],
      subject: 'Signature test — this is how your emails look',
      bodyNotes:
        'This is a test message from your platform.\n\n' +
        'Below this line is your saved email signature, rendered exactly the way funders and merchants will see it on every email you send.',
      structuredFields: [],
      attachments: [],
      signature,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: `Could not send: ${result.error}` },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, to: me.email });
  } catch (e) { return apiError(e); }
}
