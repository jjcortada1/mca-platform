import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { esignConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { encrypt } from '@/lib/crypto';
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
        hasApiKey: !!cfg?.apiKeyEncrypted,
        templateId: cfg?.templateId ?? '',
        signerRole: cfg?.signerRole ?? '',
        subject: cfg?.subject ?? '',
        message: cfg?.message ?? '',
        testMode: cfg?.testMode ?? false,
      },
    });
  } catch (e) { return apiError(e); }
}

const putSchema = z.object({
  apiKey: z.string().max(200).optional(),        // omitted = keep existing
  templateId: z.string().max(120).optional(),
  signerRole: z.string().max(100).optional(),
  subject: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  testMode: z.boolean().optional(),
});

/** PUT — save Dropbox Sign settings (admin). API key is encrypted at rest. */
export async function PUT(req: NextRequest) {
  try {
    const { companyId } = await requireCompanyAdmin();
    const body = putSchema.parse(await req.json());
    const [existing] = await db.select().from(esignConfig).where(eq(esignConfig.companyId, companyId)).limit(1);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.apiKey !== undefined && body.apiKey.trim() !== '') patch.apiKeyEncrypted = encrypt(body.apiKey.trim());
    if (body.templateId !== undefined) patch.templateId = body.templateId.trim() || null;
    if (body.signerRole !== undefined) patch.signerRole = body.signerRole.trim() || null;
    if (body.subject !== undefined) patch.subject = body.subject.trim() || null;
    if (body.message !== undefined) patch.message = body.message.trim() || null;
    if (body.testMode !== undefined) patch.testMode = body.testMode;
    if (existing) {
      await db.update(esignConfig).set(patch).where(eq(esignConfig.id, existing.id));
    } else {
      await db.insert(esignConfig).values({ companyId, ...patch });
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
