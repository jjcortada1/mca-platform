import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { matchOptions } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { requireTenantContext, requireCompanyAdmin } from '@/lib/auth/context';
import { z } from 'zod';
import { apiError } from '@/lib/api/errors';

// Match options (industries, statuses, etc.) edited in Settings must show
// up immediately on funder edit / deal shop pages with no cache delay.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/settings/match-options
 *   ?kind=credit_range  → returns options of that kind only
 *   no kind             → returns ALL options grouped by kind: { credit_range: [...], revenue_range: [...], ... }
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const url = new URL(req.url);
    const kind = url.searchParams.get('kind');

    const where = kind
      ? and(eq(matchOptions.companyId, ctx.companyId), eq(matchOptions.kind, kind))
      : eq(matchOptions.companyId, ctx.companyId);

    const rows = await db.select().from(matchOptions)
      .where(where)
      .orderBy(asc(matchOptions.kind), asc(matchOptions.sortOrder), asc(matchOptions.label));

    if (kind) {
      return NextResponse.json({ data: rows });
    }

    // Group by kind
    const grouped: Record<string, typeof rows> = {};
    for (const r of rows) {
      if (!grouped[r.kind]) grouped[r.kind] = [];
      grouped[r.kind].push(r);
    }
    return NextResponse.json({ data: grouped });
  } catch (e) {
    return apiError(e);
  }
}

const optionSchema = z.object({
  // value and label are both optional individually, but at least one must be present.
  // If only one is given, it doubles as both. This lets the UI offer a single
  // text input (e.g. for industries) where the user just types the name once.
  value: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
}).refine((o) => !!(o.value?.trim() || o.label?.trim()), {
  message: 'Each option needs a value or label.',
});

const putSchema = z.object({
  kind: z.string().min(1).max(30),
  options: z.array(optionSchema),
});

/**
 * PUT /api/settings/match-options
 * Body: { kind: 'industry', options: [...] }
 * Replaces ALL options for that kind. Existing rows are deleted first, then new ones inserted.
 */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = putSchema.parse(await req.json());

    // Delete all options of this kind for this company
    await db.delete(matchOptions).where(
      and(eq(matchOptions.companyId, ctx.companyId), eq(matchOptions.kind, body.kind))
    );

    // Insert new ones — auto-derive missing value/label. Simple kinds like
    // "industry" only need the name once; we use it for both fields.
    const toInsert = body.options
      .map((o) => {
        const labelTrim = (o.label ?? '').trim();
        const valueTrim = (o.value ?? '').trim();
        // Whichever side has text wins for the other side.
        const label = labelTrim || valueTrim;
        const value = valueTrim || labelTrim;
        return { ...o, label, value };
      })
      .filter((o) => o.value && o.label)
      .map((o, i) => ({
        companyId: ctx.companyId,
        kind: body.kind,
        value: o.value,
        label: o.label,
        sortOrder: o.sortOrder ?? i,
        isActive: o.isActive ?? true,
        meta: o.meta ?? null,
      }));

    if (toInsert.length) {
      await db.insert(matchOptions).values(toInsert);
    }

    return NextResponse.json({ ok: true, count: toInsert.length });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return apiError(e);
  }
}
