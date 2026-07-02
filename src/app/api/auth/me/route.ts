import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/me — minimal session info for the client (no secrets). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  // twoFactorEnabled isn't in the JWT/session, so read the live value from
  // the DB — otherwise the account page always shows 2FA as "disabled" even
  // when it's on. Best-effort: fall back to false if the lookup fails.
  let twoFactorEnabled = false;
  try {
    const [row] = await db
      .select({ twoFactorEnabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    twoFactorEnabled = !!row?.twoFactorEnabled;
  } catch { /* keep false */ }

  return NextResponse.json({
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      permissions: user.permissions, twoFactorEnabled,
    },
  });
}
