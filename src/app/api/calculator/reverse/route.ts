import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/context';
import { reverseCalcSchema } from '@/lib/validation/schemas';
import { reverseCalculate } from '@/lib/calculator/reverse';

export async function POST(req: NextRequest) {
  try {
    await requirePermission('calculator.use');
    const input = reverseCalcSchema.parse(await req.json());
    const candidates = reverseCalculate(input);
    return NextResponse.json({ candidates });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
