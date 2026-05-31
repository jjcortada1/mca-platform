import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  deals, submissions, submissionFunders, submissionEmails, funders,
  users, companies,
} from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { sendDealEmailBatch, type EmailAttachment, type SmtpConfig } from '@/lib/email/smtp';
import { apiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';

export const runtime = 'nodejs';

interface FunderSubmission {
  funderId?: string;
  manualFunderName?: string;
  toEmail: string;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('deals.submit');

    // Throttle: max 20 send operations per user per minute (each op may fan out
    // to many funders). Blunts double-clicks and runaway loops.
    const rl = rateLimit(`send:${ctx.user.id}`, { max: 20, windowMs: 60_000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many sends. Try again in ${rl.retryAfterSec}s.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const formData = await req.formData();

    // Accept either an existing deal by ID, or a new dealName to auto-create.
    // Field names are flexible: dealId / deal_id, dealName / deal_name, notes / bodyNotes
    let dealId = (formData.get('dealId') as string) || (formData.get('deal_id') as string) || '';
    const dealName = ((formData.get('dealName') as string) || (formData.get('deal_name') as string) || '').trim();
    const bodyNotes = ((formData.get('notes') as string) || (formData.get('bodyNotes') as string) || '');
    // Optional: assign the deal to a specific rep. Falls back to the sender.
    const assignedRepIdRaw = (formData.get('assignedRepId') as string) || (formData.get('assigned_rep_id') as string) || '';
    const assignedRepId = assignedRepIdRaw.trim() || ctx.user.id;

    // Safe JSON parsing — malformed payloads return a clean 400, not a 500.
    let ccEmails: string[];
    let fundersInput: FunderSubmission[];
    let structuredFieldsInput: { label: string; value: string }[];
    try {
      ccEmails = JSON.parse((formData.get('ccEmails') as string) || '[]');
      fundersInput = JSON.parse((formData.get('funders') as string) || '[]');
      structuredFieldsInput = JSON.parse((formData.get('structuredFields') as string) || '[]');
    } catch {
      return NextResponse.json({ error: 'Malformed request payload' }, { status: 400 });
    }
    if (!Array.isArray(ccEmails) || !Array.isArray(fundersInput) || !Array.isArray(structuredFieldsInput)) {
      return NextResponse.json({ error: 'Malformed request payload' }, { status: 400 });
    }

    if (!fundersInput.length) {
      return NextResponse.json({ error: 'No funders selected' }, { status: 400 });
    }
    if (!dealId && !dealName) {
      return NextResponse.json({ error: 'Either dealId or dealName is required' }, { status: 400 });
    }

    // Resolve or create the deal
    // Validate that the chosen rep belongs to this company (admins can assign
    // anyone; non-admins are silently forced to themselves).
    let resolvedRepId = ctx.user.id;
    const isAdmin = ctx.user.role === 'company_admin' || ctx.user.role === 'master_admin';
    if (isAdmin && assignedRepId) {
      const [rep] = await db.select({ id: users.id, role: users.role })
        .from(users)
        .where(and(eq(users.id, assignedRepId), eq(users.companyId, ctx.companyId)))
        .limit(1);
      // Lead source users can't own deals — fall back to sender if someone tries.
      if (rep && rep.role !== 'lead_source') resolvedRepId = rep.id;
    }

    let deal;
    if (dealId) {
      const [found] = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, dealId), eq(deals.companyId, ctx.companyId)))
        .limit(1);
      if (!found) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      deal = found;
      // If the admin explicitly picked a different rep for this submission,
      // propagate that to the deal record.
      if (isAdmin && assignedRepIdRaw && resolvedRepId !== found.assignedRepId) {
        await db.update(deals).set({ assignedRepId: resolvedRepId, updatedAt: new Date() })
          .where(eq(deals.id, found.id));
        deal = { ...found, assignedRepId: resolvedRepId };
      }
    } else {
      // Auto-create a minimal deal from dealName
      const [created] = await db
        .insert(deals)
        .values({
          companyId: ctx.companyId,
          name: dealName,
          status: 'shopping',
          assignedRepId: resolvedRepId,
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

    // Build the list of funders to actually send to (after dedupe).
    // Each entry maps 1:1 to a separate, isolated email.
    type Target = {
      fi: FunderSubmission;
      fName: string;
      ref: string;
    };
    const toSend: Target[] = [];
    const results: Array<{ toEmail: string; funderName: string; success: boolean; error?: string }> = [];

    let refCounter = 0;
    for (const fi of fundersInput) {
      const fName = fi.funderId
        ? (dirFunders.find((f) => f.id === fi.funderId)?.name ?? 'Unknown')
        : (fi.manualFunderName ?? fi.toEmail);

      // Dedupe — already submitted to this funder on this deal
      if (fi.funderId && existingDirIds.has(fi.funderId)) {
        results.push({ toEmail: fi.toEmail, funderName: fName, success: true, error: 'already submitted' });
        continue;
      }
      if (!fi.funderId && fi.manualFunderName && existingManual.has(fi.manualFunderName.toLowerCase())) {
        results.push({ toEmail: fi.toEmail, funderName: fName, success: true, error: 'already submitted' });
        continue;
      }
      // Guard: must have a deliverable address
      if (!fi.toEmail || !fi.toEmail.includes('@')) {
        results.push({ toEmail: fi.toEmail ?? '', funderName: fName, success: false, error: 'No valid email for this funder' });
        continue;
      }

      toSend.push({ fi, fName, ref: `r${refCounter++}` });
    }

    // Send all as isolated messages over a single pooled connection.
    // Each funder gets its OWN email with its own subject suffix so each one
    // lands in a separate conversation thread on the sender's side.
    const sendResults = toSend.length
      ? await sendDealEmailBatch(
          {
            smtp,
            ccEmails: allCc,
            dealName: deal.name,
            bodyNotes,
            structuredFields: structuredFieldsInput,
            attachments,
          },
          toSend.map((t) => ({ toEmail: t.fi.toEmail, ref: t.ref, label: t.fName }))
        )
      : [];
    const byRef = new Map(sendResults.map((r) => [r.ref, r]));

    // Persist one submissionFunder + submissionEmail per target.
    for (const t of toSend) {
      const sr = byRef.get(t.ref);
      const [sf] = await db
        .insert(submissionFunders)
        .values({
          submissionId: submission.id,
          funderId: t.fi.funderId ?? null,
          manualFunderName: t.fi.funderId ? null : t.fi.manualFunderName ?? null,
          submittedBy: ctx.user.id,
          status: 'no_response',
        })
        .returning();

      // Mirror the per-recipient subject we used on the actual send.
      await db.insert(submissionEmails).values({
        submissionFunderId: sf.id,
        toEmail: t.fi.toEmail,
        ccEmails: allCc,
        subject: `New Deal - ${deal.name}`,
        body: bodyNotes,
        attachmentMeta: attachments.map((a) => ({ name: a.filename, size: a.content.length })),
        smtpMessageId: sr?.messageId,
        smtpResponse: sr?.response,
        success: sr?.success ?? false,
        errorMessage: sr?.error,
      });

      results.push({
        toEmail: t.fi.toEmail,
        funderName: t.fName,
        success: sr?.success ?? false,
        error: sr?.error,
      });
    }

    // Bump deal status if currently shopping
    if (deal.status === 'shopping') {
      await db.update(deals).set({ status: 'submitted' })
        .where(and(eq(deals.id, deal.id), eq(deals.companyId, ctx.companyId)));
    }

    return NextResponse.json({ submissionId: submission.id, results });
  } catch (e) {
    return apiError(e);
  }
}
