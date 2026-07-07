import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { notifications } from '@/lib/db/schema';
import { and, eq, desc, isNull, inArray } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/notifications — latest 30 for the current user + unread count.
 * Polled by the bell; must stay cheap (one indexed query).
 */
export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(30);
    const unread = rows.filter((r) => !r.readAt).length;
    return NextResponse.json({ data: rows, unread });
  } catch (e) { return apiError(e); }
}

const patchSchema = z.object({
  // Specific ids to mark read, or markAllRead for the whole list.
  ids: z.array(z.string().uuid()).max(100).optional(),
  markAllRead: z.boolean().optional(),
});

/** PATCH /api/notifications — mark read (own notifications only). */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = patchSchema.parse(await req.json());
    const now = new Date();
    if (body.markAllRead) {
      await db.update(notifications)
        .set({ readAt: now })
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    } else if (body.ids?.length) {
      await db.update(notifications)
        .set({ readAt: now })
        .where(and(eq(notifications.userId, user.id), inArray(notifications.id, body.ids)));
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
