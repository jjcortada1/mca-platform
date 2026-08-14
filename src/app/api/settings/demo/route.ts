import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireMasterAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { ensureDemoCompany, destroyDemoCompany } from '@/lib/demo/seed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Demo mode — platform owner only.
 *
 * requireMasterAdmin reads the user's REAL company (it never goes through
 * the demo-aware tenant gate), so the switch is always reachable — you can
 * turn demo off from inside demo.
 */
export async function GET() {
  try {
    const me = await requireMasterAdmin();
    const [row] = await db
      .select({ demoMode: users.demoMode, demoCompanyId: users.demoCompanyId })
      .from(users).where(eq(users.id, me.id)).limit(1);
    return NextResponse.json({
      data: {
        enabled: Boolean(row?.demoMode),
        seeded: Boolean(row?.demoCompanyId),
      },
    });
  } catch (e) { return apiError(e); }
}

const bodySchema = z.object({
  enabled: z.boolean(),
  /** Rebuild the demo data from scratch. */
  reset: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const me = await requireMasterAdmin();
    const body = bodySchema.parse(await req.json());

    const [row] = await db
      .select({ demoCompanyId: users.demoCompanyId })
      .from(users).where(eq(users.id, me.id)).limit(1);

    let demoCompanyId = row?.demoCompanyId ?? null;

    if (body.reset && demoCompanyId) {
      await destroyDemoCompany(demoCompanyId);
      demoCompanyId = null;
    }

    if (body.enabled) {
      const seeded = await ensureDemoCompany(me.id, demoCompanyId);
      demoCompanyId = seeded.companyId;
    }

    await db.update(users)
      .set({ demoMode: body.enabled, demoCompanyId })
      .where(eq(users.id, me.id));

    return NextResponse.json({ data: { enabled: body.enabled, seeded: Boolean(demoCompanyId) } });
  } catch (e) { return apiError(e); }
}
