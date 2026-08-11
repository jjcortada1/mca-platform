import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { emailAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { decryptToken, revokeToken } from '@/lib/email/google';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({ sendEnabled: z.boolean().optional() });

/** Only ever act on a mailbox the caller owns. */
async function ownedRow(id: string, userId: string) {
  const [row] = await db.select().from(emailAccounts)
    .where(and(eq(emailAccounts.id, id), eq(emailAccounts.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** PATCH — toggle whether this mailbox is used for sending. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const row = await ownedRow(params.id, ctx.user.id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = patchSchema.parse(await req.json());
    if (body.sendEnabled !== undefined) {
      await db.update(emailAccounts)
        .set({ sendEnabled: body.sendEnabled, updatedAt: new Date() })
        .where(eq(emailAccounts.id, row.id));
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/** DELETE — disconnect: revoke at Google, then forget the mailbox. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireTenantContext();
    const row = await ownedRow(params.id, ctx.user.id);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (row.refreshToken) {
      try { await revokeToken(decryptToken(row.refreshToken)); } catch { /* best effort */ }
    }
    await db.delete(emailAccounts).where(eq(emailAccounts.id, row.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
