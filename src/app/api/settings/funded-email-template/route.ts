import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireCompanyAdmin, requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Funded Email Template — managed by company admin, used by every rep.
 *
 *   subject: string (e.g. "Funded — {merchantName}")
 *   fields:  ordered array of { id, label, recommended? }
 *            Each becomes its own line in the email body when the rep sends.
 *   attachmentNote: shown next to the attach-files UI as a recommendation
 *                   ("Please attach the signed contract and void check.")
 *
 * Reps cannot edit this — they only fill it out at send time.
 */

const fieldSchema = z.object({
  // Stable id for ordering / referencing; auto-generated if missing.
  id: z.string().max(80).optional(),
  label: z.string().min(1).max(200),
  // Optional hint shown under the input to help the rep
  hint: z.string().max(400).optional(),
  // Input type. 'date' renders a date picker on the send page and gets
  // formatted as "Jan 15, 2026" in the email body. 'text' is free-form.
  // Defaults to 'text' for back-compat. Existing fields whose label contains
  // "date" are auto-treated as date on the rep side even without this set.
  type: z.enum(['text', 'date']).optional(),
});

const templateSchema = z.object({
  subject: z.string().min(1).max(300),
  fields: z.array(fieldSchema).max(40),
  attachmentNote: z.string().max(1000).optional().nullable(),
});

// GET: anyone authenticated in the company can read (reps need it to fill in)
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [c] = await db.select({ tmpl: companies.fundedEmailTemplate })
      .from(companies)
      .where(eq(companies.id, ctx.companyId))
      .limit(1);
    return NextResponse.json({ data: c?.tmpl ?? null });
  } catch (e) { return apiError(e); }
}

// PUT: admin only
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = templateSchema.parse(await req.json());
    // Assign stable ids to any field that doesn't have one — used for form
    // state keys on the rep side. Existing ids are preserved.
    const fields = body.fields.map((f, i) => ({
      id: f.id?.trim() || `f${Date.now().toString(36)}_${i}`,
      label: f.label.trim(),
      hint: f.hint?.trim() || undefined,
      type: f.type ?? 'text',
    }));
    await db.update(companies)
      .set({
        fundedEmailTemplate: {
          subject: body.subject.trim(),
          fields,
          attachmentNote: body.attachmentNote?.trim() || null,
        },
        updatedAt: new Date(),
      })
      .where(eq(companies.id, ctx.companyId));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
