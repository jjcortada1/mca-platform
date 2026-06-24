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
 * Admin-controlled sidebar ordering — supports two shapes:
 *
 *   { order: string[] }                    flat ordering, legacy
 *   { categories: [{id,label,items[]}] }   grouped sections
 *
 * When BOTH are saved on the row, `categories` wins. NULL/missing for both =
 * fall back to the hardcoded default categories in components/sidebar.tsx.
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [row] = await db
      .select({
        sidebarOrder: companies.sidebarOrder,
        sidebarCategories: companies.sidebarCategories,
        sidebarItemOverrides: companies.sidebarItemOverrides,
      })
      .from(companies)
      .where(eq(companies.id, ctx.companyId))
      .limit(1);
    return NextResponse.json({
      data: {
        order: row?.sidebarOrder ?? null,
        categories: row?.sidebarCategories ?? null,
        itemOverrides: row?.sidebarItemOverrides ?? null,
      },
    });
  } catch (e) { return apiError(e); }
}

const categorySchema = z.object({
  id: z.string().max(80),
  label: z.string().max(80),
  items: z.array(z.string().max(80)).max(40),
});

// Per-item override schema — label rename + icon rename are independent;
// both optional. Empty/missing keys = fall back to the hardcoded default.
const overrideSchema = z.object({
  label: z.string().max(80).optional(),
  icon: z.string().max(60).optional(),
});

const schema = z.object({
  // Hard cap on length so a malformed payload can't blow up the DB row size.
  // Each entry is a path-like string ("/deal-shop"), capped at 80 chars.
  order: z.array(z.string().max(80)).max(40).nullable().optional(),
  categories: z.array(categorySchema).max(20).nullable().optional(),
  // Keyed by href. We cap key count at 60 so a runaway payload can't blow
  // up the row even if every conceivable nav item gets an override.
  itemOverrides: z.record(z.string().max(80), overrideSchema).nullable().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = schema.parse(await req.json());

    // Sanitize hrefs in either shape: keep only entries that look like
    // internal paths, drop blanks, dedupe in case the UI accidentally sends
    // a key twice.
    const cleanHref = (s: string) => String(s ?? '').trim();
    const validHref = (s: string) => /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i.test(s);

    const cleanedOrder = body.order
      ? Array.from(new Set(body.order.map(cleanHref).filter(validHref)))
      : null;

    let cleanedCategories: { id: string; label: string; items: string[] }[] | null = null;
    if (body.categories) {
      const seenHrefs = new Set<string>();
      cleanedCategories = body.categories
        .map((cat) => ({
          id: cleanHref(cat.id) || `cat_${Date.now().toString(36)}`,
          label: cat.label.trim().slice(0, 80) || 'Section',
          items: cat.items
            .map(cleanHref)
            .filter(validHref)
            .filter((h) => {
              // Dedupe across all categories — an item can only live in one place.
              if (seenHrefs.has(h)) return false;
              seenHrefs.add(h);
              return true;
            }),
        }))
        .filter((cat) => cat.items.length > 0);
    }

    // Sanitize item overrides — drop empty entries so we don't store an
    // entry like { label: '', icon: '' } that would do nothing on render.
    let cleanedOverrides: Record<string, { label?: string; icon?: string }> | null = null;
    if (body.itemOverrides) {
      cleanedOverrides = {};
      for (const [href, ov] of Object.entries(body.itemOverrides)) {
        const h = cleanHref(href);
        if (!validHref(h)) continue;
        const label = ov.label?.trim();
        const icon = ov.icon?.trim();
        if (!label && !icon) continue; // empty override — skip
        cleanedOverrides[h] = {};
        if (label) cleanedOverrides[h].label = label.slice(0, 80);
        if (icon) cleanedOverrides[h].icon = icon.slice(0, 60);
      }
      if (Object.keys(cleanedOverrides).length === 0) cleanedOverrides = null;
    }

    await db.update(companies)
      .set({
        sidebarOrder: cleanedOrder,
        sidebarCategories: cleanedCategories,
        sidebarItemOverrides: cleanedOverrides,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, ctx.companyId));
    return NextResponse.json({
      ok: true,
      data: { order: cleanedOrder, categories: cleanedCategories, itemOverrides: cleanedOverrides },
    });
  } catch (e) { return apiError(e); }
}
