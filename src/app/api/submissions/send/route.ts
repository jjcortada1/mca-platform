import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  deals, submissions, submissionFunders, submissionEmails, funders,
  users, companies,
} from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { sendDealEmail, type EmailAttachment, type SmtpConfig } from '@/lib/email/smtp';

export const runtime = 'nodejs';

interface FunderSubmission {
  funderId?: string;
  manualFunderName?: string;
  toEmail: string;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('deals.submit');
    const formData = await req.formData();

    // Accept either an existing deal by ID, or a new dealName to auto-create.
    // Field names are flexible: dealId / deal_id, dealName / deal_name, notes / bodyNotes
    let dealId = (formData.get('dealId') as string) || (formData.get('deal_id') as string) || '';
    const dealName = ((formData.get('dealName') as string) || (formData.get('deal_name') as string) || '').trim();
    const bodyNotes = ((formData.get('notes') as string) || (formData.get('bodyNotes') as string) || '');
    const ccEmails = JSON.parse((formData.get('ccEmails') as string) || '[]') as string[];
    const fundersInput = JSON.parse(formData.get('funders') as string) as FunderSubmission[];
    const structuredFieldsInput = JSON.parse(
      (formData.get('structuredFields') as string) || '[]'
    ) as { label: string; value: string }[];

    if (!fundersInput.length) {
      return NextResponse.json({ error: 'No funders selected' }, { status: 400 });
    }
    if (!dealId && !dealName) {
      return NextResponse.json({ error: 'Either dealId or dealName is required' }, { status: 400 });
    }

    // Resolve or create the deal
    let deal;
    if (dealId) {
      const [found] = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, dealId), eq(deals.companyId, ctx.companyId)))
        .limit(1);
      if (!found) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      deal = found;
    } else {
      // Auto-create a minimal deal from dealName
      const [created] = await db
        .insert(deals)
        .values({
          companyId: ctx.companyId,
          name: dealName,
          status: 'shopping',
          assignedRepId: ctx.user.id,
          createdBy: ctx.user.id,
        })
        .returning();
      deal = created;
      dealId = created.id;
    }

    // Read attachments (memory only — never persisted)
    const attachments: EmailAttachment[] = [];
    for (const [, value] of Array.from(formData.entries())) {
      if (value instanceof File) {
        const buf = Buffer.from(await value.arrayBuffer());
        attachments.push({ filename: value.name, content: buf, contentType: value.type || undefined });
      }
    }
    if (attachments.length > 30) {
      return NextResponse.json({ error: 'Max 30 attachments' }, { status: 400 });
    }

    // Resolve SMTP config based on company emailMode
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
        { error: 'No SMTP configured. Configure in Settings.' },
        { status: 400 }
      );
    }

    // Merge global CC
    const globalCc = (company.globalCcEmails as string[] | null) ?? [];
    const allCc = Array.from(new Set([...ccEmails, ...globalCc]));

    // Upsert submission row (one per deal, ever)
    let [submission] = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.dealId, dealId), eq(submissions.companyId, ctx.companyId)))
      .limit(1);
    if (!submission) {
      [submission] = await db
        .insert(submissions)
        .values({ dealId, companyId: ctx.companyId })
        .returning();
    } else {
      await db.update(submissions).set({ updatedAt: new Date() })
        .where(and(eq(submissions.id, submission.id), eq(submissions.companyId, ctx.companyId)));
    }

    // Existing funders in this submission — skip duplicates
    const existing = await db
      .select()
      .from(submissionFunders)
      .where(eq(submissionFunders.submissionId, submission.id));
    const existingDirIds = new Set(existing.filter((f) => f.funderId).map((f) => f.funderId));
    const existingManual = new Set(
      existing.filter((f) => !f.funderId && f.manualFunderName).map((f) => f.manualFunderName!.toLowerCase())
    );

    // Get funder names for nicer logging
    // Validate any directory funder IDs belong to current company (cross-tenant guard)
    const dirIds = fundersInput.map((f) => f.funderId).filter(Boolean) as string[];
    const dirFunders = dirIds.length
      ? await db.select().from(funders).where(and(eq(funders.companyId, ctx.companyId), inArray(funders.id, dirIds)))
      : [];
    const validDirIds = new Set(dirFunders.map((f) => f.id));
    const invalidIds = dirIds.filter((id) => !validDirIds.has(id));
    if (invalidIds.length) {
      return NextResponse.json(
        { error: `Funders not found in this company: ${invalidIds.join(', ')}` },
        { status: 400 }
      );
    }

    // Send each funder a separate email
    const results: Array<{ toEmail: string; funderName: string; success: boolean; error?: string }> = [];
    for (const fi of fundersInput) {
      const fName = fi.funderId
        ? (dirFunders.find((f) => f.id === fi.funderId)?.name ?? 'Unknown')
        : (fi.manualFunderName ?? fi.toEmail);
      // Dedupe
      if (fi.funderId && existingDirIds.has(fi.funderId)) {
        results.push({ toEmail: fi.toEmail, funderName: fName, success: true, error: 'already submitted' });
        continue;
      }
      if (!fi.funderId && fi.manualFunderName && existingManual.has(fi.manualFunderName.toLowerCase())) {
        results.push({ toEmail: fi.toEmail, funderName: fName, success: true, error: 'already submitted' });
        continue;
      }

      const sendResult = await sendDealEmail({
        smtp,
        toEmail: fi.toEmail,
        ccEmails: allCc,
        dealName: deal.name,
        bodyNotes,
        structuredFields: structuredFieldsInput,
        attachments,
      });

      const [sf] = await db
        .insert(submissionFunders)
        .values({
          submissionId: submission.id,
          funderId: fi.funderId ?? null,
          manualFunderName: fi.funderId ? null : fi.manualFunderName ?? null,
          submittedBy: ctx.user.id,
          status: 'no_response',
        })
        .returning();

      await db.insert(submissionEmails).values({
        submissionFunderId: sf.id,
        toEmail: fi.toEmail,
        ccEmails: allCc,
        subject: `NEW DEAL | ${deal.name}`,
        body: bodyNotes,
        attachmentMeta: attachments.map((a) => ({ name: a.filename, size: a.content.length })),
        smtpMessageId: sendResult.messageId,
        smtpResponse: sendResult.response,
        success: sendResult.success,
        errorMessage: sendResult.error,
      });

      results.push({
        toEmail: fi.toEmail,
        funderName: fi.funderId
          ? (dirFunders.find((f) => f.id === fi.funderId)?.name ?? 'Unknown')
          : (fi.manualFunderName ?? fi.toEmail),
        success: sendResult.success,
        error: sendResult.error,
      });
    }

    // Bump deal status if currently shopping
    if (deal.status === 'shopping') {
      await db.update(deals).set({ status: 'submitted' })
        .where(and(eq(deals.id, deal.id), eq(deals.companyId, ctx.companyId)));
    }

    return NextResponse.json({ submissionId: submission.id, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
