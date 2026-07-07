import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { esignConfig, esignRequests, users } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { decrypt } from '@/lib/crypto';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — recent signature requests for this company (newest first). */
export async function GET() {
  try {
    const ctx = await requirePermission('deals.submit');
    const rows = await db
      .select({
        id: esignRequests.id,
        recipientName: esignRequests.recipientName,
        recipientEmail: esignRequests.recipientEmail,
        status: esignRequests.status,
        createdAt: esignRequests.createdAt,
        senderName: users.name,
      })
      .from(esignRequests)
      .leftJoin(users, eq(users.id, esignRequests.createdBy))
      .where(eq(esignRequests.companyId, ctx.companyId))
      .orderBy(desc(esignRequests.createdAt))
      .limit(50);
    return NextResponse.json({ data: rows });
  } catch (e) { return apiError(e); }
}

const sendSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  message: z.string().max(2000).optional().nullable(),
});

/**
 * POST — send the application template to someone via Dropbox Sign.
 * Type a name + email; Dropbox Sign emails them the signature request.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('deals.submit');
    const body = sendSchema.parse(await req.json());

    const [cfg] = await db.select().from(esignConfig)
      .where(eq(esignConfig.companyId, ctx.companyId)).limit(1);
    if (!cfg?.apiKeyEncrypted || !cfg.templateId || !cfg.signerRole) {
      return NextResponse.json(
        { error: 'Dropbox Sign isn\'t set up yet. An admin needs to add the API key, template ID, and signer role in Settings → E-sign applications.' },
        { status: 400 },
      );
    }

    let apiKey: string;
    try {
      apiKey = decrypt(cfg.apiKeyEncrypted);
    } catch {
      return NextResponse.json({ error: 'Stored API key could not be read — re-save it in Settings.' }, { status: 500 });
    }

    // Dropbox Sign (formerly HelloSign) — send a signature request from a
    // template. Auth is HTTP Basic with the API key as the username.
    const dsRes = await fetch('https://api.hellosign.com/v3/signature_request/send_with_template', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_ids: [cfg.templateId],
        subject: cfg.subject || 'Please sign your application',
        message: body.message?.trim() || cfg.message || '',
        signers: [{ role: cfg.signerRole, name: body.name.trim(), email_address: body.email.trim().toLowerCase() }],
        test_mode: cfg.testMode ? 1 : 0,
      }),
    });

    const dsJson = await dsRes.json().catch(() => ({} as Record<string, unknown>));
    if (!dsRes.ok) {
      const msg = (dsJson as { error?: { error_msg?: string } })?.error?.error_msg
        || `Dropbox Sign rejected the request (HTTP ${dsRes.status}).`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    const sigId = (dsJson as { signature_request?: { signature_request_id?: string } })
      ?.signature_request?.signature_request_id ?? null;

    const [row] = await db.insert(esignRequests).values({
      companyId: ctx.companyId,
      recipientName: body.name.trim(),
      recipientEmail: body.email.trim().toLowerCase(),
      signatureRequestId: sigId,
      status: 'sent',
      createdBy: ctx.user.id,
    }).returning();

    return NextResponse.json({ ok: true, data: row });
  } catch (e) { return apiError(e); }
}
