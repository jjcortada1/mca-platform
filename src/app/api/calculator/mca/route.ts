import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { commissionRules } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { mcaCalcSchema } from '@/lib/validation/schemas';
import { calculateMCA, DEFAULT_COMMISSION_RULES, type CommissionRule } from '@/lib/calculator/mca';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('calculator.use');
    const input = mcaCalcSchema.parse(await req.json());
    const dbRules = await db.select().from(commissionRules).where(eq(commissionRules.companyId, ctx.companyId));
    const rules: CommissionRule[] = dbRules.length
      ? dbRules.map((r) => ({ threshold: parseFloat(r.threshold), commissionPct: parseFloat(r.commissionPct) }))
      : DEFAULT_COMMISSION_RULES;
    const result = calculateMCA({ ...input, commissionRules: rules });
    return NextResponse.json(result);
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
