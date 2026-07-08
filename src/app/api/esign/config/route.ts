import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { esignConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — the company's Dropbox Sign settings. The API key itself is never
 * returned; only whether one is saved.
 */
export async function GET() {
  try {
    const { companyId } = await requireCompanyAdmin();
    const [cfg] = await db.select().from(esignConfig).where(eq(esignConfig.companyId, companyId)).limit(1);
    return NextResponse.json({
      data: {
        applicationUrl: cfg?.applicationUrl ?? '',
        emailBody: cfg?.emailBody ?? '',
      },
    });
  } catch (e) { return apiError(e); }
}

const putSchema = z.object({
  applicationUrl: z.string().max(2000).optional(),
  emailBody: z.string().max(4000).optional(),
});

/** PUT — save the application link + the saved email body (admin). */
export async function PUT(req: NextRequest) {
  try {
    const { companyId } = await requireCompanyAdmin();
    const body = putSchema.parse(await req.json());
    if (body.applicationUrl && body.applicationUrl.trim() && !/^https?:\/\//i.test(body.applicationUrl.trim())) {
      return NextResponse.json({ error: 'The application link must start with http:// or https://' }, { status: 400 });
    }
    const [existing] = await db.select().from(esignConfig).where(eq(esignConfig.companyId, companyId)).limit(1);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.applicationUrl !== undefined) patch.applicationUrl = body.applicationUrl.trim() || null;
    if (body.emailBody !== undefined) patch.emailBody = body.emailBody.trim() || null;
    if (existing) {
      await db.update(esignConfig).set(patch).where(eq(esignConfig.id, existing.id));
    } else {
      await db.insert(esignConfig).values({ companyId, ...patch });
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
