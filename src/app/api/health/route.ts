import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Lightweight liveness + DB connectivity probe. Returns 200 when the app can
 * reach the database, 503 otherwise. Safe to expose (no secrets, no data).
 */
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
  } catch {
    // Never leak the underlying error — just report degraded.
    return NextResponse.json({ status: 'degraded', db: 'down' }, { status: 503 });
  }
}
