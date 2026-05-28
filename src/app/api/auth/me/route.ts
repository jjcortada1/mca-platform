import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/me — minimal session info for the client (no secrets). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions },
  });
}
