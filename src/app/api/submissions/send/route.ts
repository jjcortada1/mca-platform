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
import { triggerSync } from '@/lib/sheets/sync';

export const runtime = 'nodejs';

interface FunderSubmission {
  funderId?: string;
  manualFunderName?: string;
  // Plural — one funder may have multiple submission emails that all need to
  // ride on the SAME outgoing message (so they're a single thread per funder).
  // Falls back to the singular legacy field if a caller hasn't updated yet.
  toEmails?: string[];
  toEmail?: string;
}

/** Normalize a funder entry to a deduped, lowercased array of addresses. */
function normalizeToEmails(fi: FunderSubmission): string[] {
  const raw = (fi.toEmails && fi.toEmails.length) ? fi.toEmails : (fi.toEmail ? [fi.toEmail] : []);
  return Array.from(new Set(
    raw
      .map((e) => String(e ?? '').trim())
      .filter((e) => e && e.includes('@'))
      .map((e) => e.toLowerCase())
  ));
}

/**
 * Defang an uploaded filename so it can't smuggle path traversal or email
 * header injection. The original filename is just a label for the recipient —
 * we never use it to write to disk, but Gmail/Outlook DO display it, and
 * nodemailer puts it on the Content-Disposition header.
 */
function sanitizeFilename(raw: string): string {
  let name = String(raw ?? '').trim();
  // Drop NUL and CR/LF (header injection)
  name = name.replace(/[\r\n\0]/g, '');
  // Drop path separators
  name = name.replace(/[/\\]/g, '_');
  // Strip any leading dots / dotted segments (no traversal, no hidden files)
  name = name.replace(/^\.+/, '');
  // Cap length so a 2000-char filename can't blow up headers
  if (name.length > 200) name = name.slice(0, 200);
  return name || 'attachment';
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

    // Resolve or create the deal.
    // Any sender (rep, admin) can choose who the deal is assigned to. Default
    // is the sender themselves. Lead source users are NEVER valid assignees.
    let resolvedRepId = ctx.user.id;
    if (assignedRepId) {
      const [rep] = await db.select({ id: users.id, role: users.role })
        .from(users)
        .where(and(eq(users.id, assignedRepId), eq(users.companyId, ctx.companyId)))
        .limit(1);
      if (rep && rep.role !== 'lead_source') resolvedRepId = rep.id;
    }

    let deal;
    if (dealId) {
      const [found] = await db
        .select()
        .from(deals)
        .where(and(eq(deals.id, dealId), eq(deals.companyId, ctx.companyId), eq(deals.isDeleted, false)))
        .limit(1);
      if (!found) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
      deal = found;
      // Propagate the chosen rep to the deal record. Now allowed for any
      // sender (no longer admin-gated) — a rep can reassign a deal to a
      // teammate when shopping on their behalf.
      if (assignedRepIdRaw && resolvedRepId !== found.assignedRepId) {
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

    // Read attachments (memory only — never persisted).
    // SECURITY:
    //   - Per-file cap: 25 MB (Gmail limit anyway; bigger files won't send).
    //   - Aggregate cap: 50 MB across all attachments per submission.
    //   - Filename sanitization: strip path separators, CR/LF (header injection),
    //     NUL, and limit length. Attachers shouldn't be able to smuggle a
    //     "../../../etc/passwd" or "\r\nBcc: attacker@x.com" into the email.
    const MAX_FILE_BYTES = 25 * 1024 * 1024;
    const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
    const MAX_ATTACHMENTS = 30;
    const attachments: EmailAttachment[] = [];
    let totalBytes = 0;
    for (const [, value] of Array.from(formData.entries())) {
      if (value instanceof File) {
        if (value.size > MAX_FILE_BYTES) {
          return NextResponse.json(
            { error: `Attachment "${value.name}" is too large (>25MB).` },
            { status: 413 }
          );
        }
        totalBytes += value.size;
        if (totalBytes > MAX_TOTAL_BYTES) {
          return NextResponse.json(
            { error: 'Total attachment size exceeds 50MB.' },
            { status: 413 }
          );
        }
        if (attachments.length >= MAX_ATTACHMENTS) {
          return NextResponse.json({ error: `Max ${MAX_ATTACHMENTS} attachments` }, { status: 400 });
        }
        const buf = Buffer.from(await value.arrayBuffer());
        const safeName = sanitizeFilename(value.name);
        attachments.push({ filename: safeName, content: buf, contentType: value.type || undefined });
      }
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
      // Distinct messages by mode so the rep knows exactly where to go.
      // Per-rep mode means the rep configures their OWN SMTP on /account.
      // Shared mode means an admin needs to set the company SMTP in /settings.
      const isPerRep = company.emailMode === 'per_rep';
      return NextResponse.json(
        {
          error: isPerRep
            ? 'Your email account isn\'t connected yet. Go to "My account" → "My email SMTP" and set it up before shopping deals.'
            : 'Email is not configured for the company yet. Ask an admin to set up SMTP in Settings.',
        },
        { status: 400 }
      );
    }

    // Merge company's global CC + the SENDER's "always CC".
    //
    // IMPORTANT: this is the SENDER's always-CC only — never the assigned
    // rep's. If an admin shops on behalf of a rep, the rep's manager-CC
    // should NOT be added: the rep didn't send this email, so their
    // personal CC preference doesn't apply. The setting is "always CC ME on
    // emails I send," not "always CC me on emails about my deals."
    const globalCc = (company.globalCcEmails as string[] | null) ?? [];
    const [senderRow] = await db.select({ alwaysCcEmail: users.alwaysCcEmail })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    const senderAlwaysCc = senderRow?.alwaysCcEmail ?? null;

    // Sender's signature — pulled from the actual sender (ctx.user), not the
    // assigned rep, because the signature represents who's writing the email.
    const [senderUser] = await db
      .select({
        emailSignature: users.emailSignature,
        signatureLogoUrl: users.signatureLogoUrl,
        signatureLink: users.signatureLink,
      })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    const signature = (senderUser?.emailSignature || senderUser?.signatureLogoUrl || senderUser?.signatureLink)
      ? {
          text: senderUser.emailSignature ?? '',
          logoDataUri: senderUser.signatureLogoUrl ?? null,
          link: senderUser.signatureLink ?? null,
        }
      : null;

    const allCc = Array.from(new Set([
      ...ccEmails,
      ...globalCc,
      ...(senderAlwaysCc ? [senderAlwaysCc] : []),
    ].filter(Boolean)));

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
    // Each entry maps to ONE outbound message, even if the funder has
    // multiple submission emails. All addresses ride on the same email so
    // the funder's team sees a single thread, not several.
    type Target = {
      fi: FunderSubmission;
      fName: string;
      ref: string;
      addresses: string[]; // normalized, deduped
    };
    const toSend: Target[] = [];
    const results: Array<{ toEmails: string[]; funderName: string; success: boolean; error?: string }> = [];

    let refCounter = 0;
    for (const fi of fundersInput) {
      const fName = fi.funderId
        ? (dirFunders.find((f) => f.id === fi.funderId)?.name ?? 'Unknown')
        : (fi.manualFunderName ?? (fi.toEmail ?? ''));

      const addresses = normalizeToEmails(fi);

      // Dedupe — already submitted to this funder on this deal
      if (fi.funderId && existingDirIds.has(fi.funderId)) {
        results.push({ toEmails: addresses, funderName: fName, success: true, error: 'already submitted' });
        continue;
      }
      if (!fi.funderId && fi.manualFunderName && existingManual.has(fi.manualFunderName.toLowerCase())) {
        results.push({ toEmails: addresses, funderName: fName, success: true, error: 'already submitted' });
        continue;
      }
      // Guard: must have at least one deliverable address
      if (!addresses.length) {
        results.push({ toEmails: [], funderName: fName, success: false, error: 'No valid email for this funder' });
        continue;
      }

      toSend.push({ fi, fName, ref: `r${refCounter++}`, addresses });
    }

    // Send all as isolated messages over a single pooled connection.
    // Each FUNDER gets its OWN email (with all of that funder's addresses in
    // the To: header so it stays one thread for them), and its own subject
    // suffix so each funder's email lands in a separate conversation on the
    // sender's side. The signature (text + optional logo + optional link)
    // is built into both the text and HTML versions.
    const sendResults = toSend.length
      ? await sendDealEmailBatch(
          {
            smtp,
            ccEmails: allCc,
            dealName: deal.name,
            bodyNotes,
            structuredFields: structuredFieldsInput,
            attachments,
            signature,
          },
          toSend.map((t) => ({ toEmails: t.addresses, ref: t.ref, label: t.fName }))
        )
      : [];
    const byRef = new Map(sendResults.map((r) => [r.ref, r]));

    // Persist one submissionFunder + submissionEmail per FUNDER (not per
    // address). The submissionEmail log keeps the first/primary address in
    // its toEmail column for back-compat; the full list is joined into the
    // ccEmails field as informational context.
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

      // Primary recipient for the log row is the first address; the rest are
      // captured as part of the audit so the full delivery target is preserved.
      const primaryTo = t.addresses[0];
      const extraTo = t.addresses.slice(1);
      await db.insert(submissionEmails).values({
        submissionFunderId: sf.id,
        toEmail: primaryTo,
        // Store the company-additional addresses alongside the CCs so the
        // audit row reflects the real recipient set without losing info.
        ccEmails: [...extraTo, ...allCc],
        subject: `New Deal - ${deal.name}`,
        body: bodyNotes,
        attachmentMeta: attachments.map((a) => ({ name: a.filename, size: a.content.length })),
        smtpMessageId: sr?.messageId,
        smtpResponse: sr?.response,
        success: sr?.success ?? false,
        errorMessage: sr?.error,
      });

      results.push({
        toEmails: t.addresses,
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

    triggerSync(ctx.companyId);
    return NextResponse.json({ submissionId: submission.id, results });
  } catch (e) {
    return apiError(e);
  }
}
