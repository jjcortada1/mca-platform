import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/lib/auth/context';
import { verifySmtp } from '@/lib/email/smtp';
import { encrypt } from '@/lib/crypto';
import { z } from 'zod';

const schema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireTenantContext();
    const body = schema.parse(await req.json());
    // Encrypt-then-pass so verifySmtp can decrypt with the same flow as production
    const result = await verifySmtp({
      host: body.host,
      port: body.port,
      user: body.user,
      encryptedPass: encrypt(body.pass),
      from: body.from || body.user,
    });
    return NextResponse.json({ success: result.ok, error: result.error });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 400 });
  }
}
