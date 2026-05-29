import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireCompanyAdmin, requireTenantContext } from '@/lib/auth/context';
import { z } from 'zod';
import { apiError } from '@/lib/api/errors';

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [c] = await db.select().from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    if (!c) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    return NextResponse.json({
      data: {
        name: c.name,
        emailMode: c.emailMode,
        globalCcEmails: c.globalCcEmails ?? [],
        productName: c.productName ?? null,
        displayName: c.displayName ?? null,
        logoUrl: c.logoUrl ?? null,
        primaryColor: c.primaryColor ?? null,
        emailSignature: c.emailSignature ?? null,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

const patchSchema = z.object({
  emailMode: z.enum(['shared', 'per_rep']).optional(),
  globalCcEmails: z.array(z.string().email()).optional(),
  name: z.string().min(1).max(200).optional(),
  productName: z.string().max(100).optional().nullable(),
  displayName: z.string().max(200).optional().nullable(),
  // Accepts either an https URL OR a base64 data URI (image/png|jpeg|svg|webp).
  // Capped at ~1MB after base64 encoding (~750KB raw) so the DB row stays small.
  logoUrl: z.string().max(1_400_000).refine((v) => {
    if (!v) return true;
    if (/^https?:\/\//i.test(v)) return v.length <= 2048;
    return /^data:image\/(png|jpe?g|svg\+xml|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v);
  }, { message: 'Logo must be an https URL or an uploaded image file (PNG/JPG/SVG/WebP, max ~1MB).' }).optional().nullable().or(z.literal('')),
  // HSL string format: "hue saturation% lightness%" e.g. "184 70% 22%"
  primaryColor: z
    .string()
    .regex(/^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/, 'Format: "184 70% 22%" (hue saturation% lightness%)')
    .optional()
    .nullable()
    .or(z.literal('')),
  emailSignature: z.string().max(2000).optional().nullable(),
});

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = patchSchema.parse(await req.json());

    // Normalize empty strings to null for nullable fields
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      updates[k] = v === '' ? null : v;
    }

    await db.update(companies).set(updates).where(eq(companies.id, ctx.companyId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0]?.message || 'Validation failed' }, { status: 400 });
    }
    return apiError(e);
  }
}
