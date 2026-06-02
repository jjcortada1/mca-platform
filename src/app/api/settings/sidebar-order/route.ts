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
 * Admin-controlled sidebar ordering.
 *
 *   GET  — anyone authenticated in the company can read (the sidebar itself
 *          needs the order to render).
 *   PUT  — company_admin / master_admin only. Saves a flat array of href
 *          strings in the desired display order. The sidebar applies this
 *          order, then filters items by the user's permissions.
 *
 * NULL/missing = use the default hardcoded order in components/sidebar.tsx.
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [row] = await db.select({ sidebarOrder: companies.sidebarOrder })
      .from(companies)
      .where(eq(companies.id, ctx.companyId))
      .limit(1);
    return NextResponse.json({ data: { order: row?.sidebarOrder ?? null } });
  } catch (e) { return apiError(e); }
}

const schema = z.object({
  // Hard cap on length so a malformed payload can't blow up the DB row size.
  // Each entry is a path-like string ("/deal-shop"), capped at 80 chars.
  order: z.array(z.string().max(80)).max(40).nullable(),
});

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = schema.parse(await req.json());
    // Sanitize: keep only entries that look like internal paths, drop blanks,
    // dedupe in case the UI accidentally sends a key twice.
    const cleaned = body.order
      ? Array.from(new Set(
          body.order
            .map((s) => String(s ?? '').trim())
            .filter((s) => /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(s))
        ))
      : null;
    await db.update(companies)
      .set({ sidebarOrder: cleaned, updatedAt: new Date() })
      .where(eq(companies.id, ctx.companyId));
    return NextResponse.json({ ok: true, data: { order: cleaned } });
  } catch (e) { return apiError(e); }
}
