import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { fundedEmailContacts } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { z } from 'zod';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Per-rep saved recipient list for funded emails. Each user manages their
 * own list; no rep ever sees another rep's contacts.
 */

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  email: z.string().email().max(255).toLowerCase().trim(),
  company: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const list = await db.select().from(fundedEmailContacts)
      .where(and(eq(fundedEmailContacts.companyId, ctx.companyId), eq(fundedEmailContacts.userId, ctx.user.id)))
      .orderBy(asc(fundedEmailContacts.name));
    return NextResponse.json({ data: list });
  } catch (e) { return apiError(e); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const body = upsertSchema.parse(await req.json());

    if (body.id) {
      // Update — only the user's own row.
      await db.update(fundedEmailContacts)
        .set({
          name: body.name.trim(),
          email: body.email,
          company: body.company?.trim() || null,
          notes: body.notes?.trim() || null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(fundedEmailContacts.id, body.id),
          eq(fundedEmailContacts.companyId, ctx.companyId),
          eq(fundedEmailContacts.userId, ctx.user.id),
        ));
      return NextResponse.json({ ok: true });
    }

    const [created] = await db.insert(fundedEmailContacts).values({
      companyId: ctx.companyId,
      userId: ctx.user.id,
      name: body.name.trim(),
      email: body.email,
      company: body.company?.trim() || null,
      notes: body.notes?.trim() || null,
    }).returning();
    return NextResponse.json({ ok: true, data: created });
  } catch (e) { return apiError(e); }
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const { id } = deleteSchema.parse(await req.json());
    await db.delete(fundedEmailContacts)
      .where(and(
        eq(fundedEmailContacts.id, id),
        eq(fundedEmailContacts.companyId, ctx.companyId),
        eq(fundedEmailContacts.userId, ctx.user.id),
      ));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
