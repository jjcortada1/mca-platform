import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Toggle 2FA on/off for the current user.
 *
 * Request body:
 *   { enabled: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('*'); // Any authenticated user can toggle their own 2FA
    const body = await req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    await db
      .update(users)
      .set({ twoFactorEnabled: enabled })
      .where(eq(users.id, ctx.user.id));

    return NextResponse.json({
      success: true,
      message: enabled ? '2FA has been enabled' : '2FA has been disabled',
    });
  } catch (err) {
    console.error('[toggle-2fa]', err);
    return NextResponse.json(
      { error: 'Failed to update 2FA settings' },
      { status: 500 }
    );
  }
}
