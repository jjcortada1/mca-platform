import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET — return the user's current always-CC email (or null).
 * Every authenticated user can call this on themselves.
 */
export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    return NextResponse.json({ data: { alwaysCcEmail: me?.alwaysCcEmail ?? null } });
  } catch (e) {
    return apiError(e);
  }
}

const schema = z.object({
  // Accept a single string ("a@x.com" or "a@x.com, b@y.com"), an array of
  // strings, empty string ("" → clear), or null. Normalization/validation
  // happens in normalizeCcList below so the client can send whatever's easiest.
  alwaysCcEmail: z.union([
    z.string(),
    z.array(z.string()),
    z.null(),
  ]),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turn whatever the client sent into a clean, deduped, lowercase list of
 * valid emails. Accepts an array or a comma/semicolon-separated string.
 * CR/LF are stripped (header-injection safety); invalid entries are collected
 * so we can report them back instead of silently dropping.
 */
function normalizeCcList(input: string | string[] | null): { ok: string[]; bad: string[] } {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '').split(/[,;\n]/);
  const ok: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const part of raw) {
    const e = String(part ?? '').replace(/[\r\n]/g, '').trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e) || e.length > 255) { bad.push(part.trim()); continue; }
    if (seen.has(e)) continue;
    seen.add(e);
    ok.push(e);
  }
  return { ok, bad };
}

/**
 * PUT — update the user's always-CC email(s). Saved on the user's own row so
 * each rep has their own setting. Multiple addresses are stored comma-joined.
 * Empty/null clears it.
 */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const body = schema.parse(await req.json());
    const { ok, bad } = normalizeCcList(body.alwaysCcEmail);
    if (bad.length) {
      return NextResponse.json(
        { error: `Not a valid email: ${bad.join(', ')}` },
        { status: 400 }
      );
    }
    const value = ok.length ? ok.join(', ') : null;
    await db.update(users)
      .set({ alwaysCcEmail: value, updatedAt: new Date() })
      .where(eq(users.id, ctx.user.id));
    return NextResponse.json({ ok: true, data: { alwaysCcEmail: value } });
  } catch (e) {
    return apiError(e);
  }
}
