import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { sheetSyncConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { encrypt } from '@/lib/crypto';
import { parseServiceAccount } from '@/lib/sheets/client';
import { z } from 'zod';

export const runtime = 'nodejs';

/** GET /api/settings/sheet-sync — current config (no secrets returned). */
export async function GET() {
  try {
    const ctx = await requireCompanyAdmin();
    const [cfg] = await db.select().from(sheetSyncConfig).where(eq(sheetSyncConfig.companyId, ctx.companyId)).limit(1);
    return NextResponse.json({
      configured: !!cfg?.encryptedCredentials,
      enabled: cfg?.enabled ?? false,
      serviceAccountEmail: cfg?.serviceAccountEmail ?? null,
      spreadsheetId: cfg?.spreadsheetId ?? null,
      lastSyncAt: cfg?.lastSyncAt ?? null,
      lastSyncStatus: cfg?.lastSyncStatus ?? null,
      lastSyncError: cfg?.lastSyncError ?? null,
    });
  } catch (e) { return apiError(e); }
}

const schema = z.object({
  enabled: z.boolean().optional(),
  spreadsheetId: z.string().max(120).optional().nullable(),
  // Full service-account JSON string. Optional — omit to keep existing creds.
  credentials: z.string().optional().nullable(),
});

/** POST /api/settings/sheet-sync — save config. Encrypts credentials. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = schema.parse(await req.json());

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.spreadsheetId !== undefined) updates.spreadsheetId = body.spreadsheetId?.trim() || null;

    if (body.credentials) {
      // Validate + extract service account email, then encrypt the whole JSON.
      const sa = parseServiceAccount(body.credentials);
      updates.encryptedCredentials = encrypt(body.credentials);
      updates.serviceAccountEmail = sa.client_email;
    }

    const [existing] = await db.select().from(sheetSyncConfig).where(eq(sheetSyncConfig.companyId, ctx.companyId)).limit(1);
    if (existing) {
      await db.update(sheetSyncConfig).set(updates).where(eq(sheetSyncConfig.companyId, ctx.companyId));
    } else {
      await db.insert(sheetSyncConfig).values({
        companyId: ctx.companyId,
        enabled: (updates.enabled as boolean) ?? false,
        spreadsheetId: (updates.spreadsheetId as string) ?? null,
        encryptedCredentials: (updates.encryptedCredentials as string) ?? null,
        serviceAccountEmail: (updates.serviceAccountEmail as string) ?? null,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
