import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { pushSubscriptions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { getVapidKeys } from '@/lib/push';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — the VAPID public key the browser needs to subscribe. */
export async function GET() {
  try {
    await requireTenantContext();
    const keys = await getVapidKeys();
    if (!keys) return NextResponse.json({ error: 'Push is not available.' }, { status: 503 });
    return NextResponse.json({ publicKey: keys.publicKey });
  } catch (e) { return apiError(e); }
}

const subSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
});

/** POST — register this browser/phone for push. Idempotent per endpoint. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const body = subSchema.parse(await req.json());
    // Endpoint is globally unique — re-registering moves it to this user
    // (e.g. a shared computer where a different user logs in).
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint));
    await db.insert(pushSubscriptions).values({
      companyId: ctx.companyId,
      userId: ctx.user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

/** DELETE — unregister an endpoint (?endpoint=...). Own subscriptions only. */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const endpoint = new URL(req.url).searchParams.get('endpoint');
    if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
    await db.delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, ctx.user.id)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
