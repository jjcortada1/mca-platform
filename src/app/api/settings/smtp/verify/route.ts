import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { companies, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireTenantContext, requireCompanyAdmin } from '@/lib/auth/context';
import { verifySmtp } from '@/lib/email/smtp';
import { encrypt } from '@/lib/crypto';
import { z } from 'zod';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  encryptedPass: string;
  from?: string;
  secure?: boolean;
}

const schema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().optional(),
  // When true (default), a successful verification also PERSISTS the config so
  // users don't need a separate Save click. Set false to verify-only.
  persistOnSuccess: z.boolean().optional().default(true),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const body = schema.parse(await req.json());

    // Encrypt the password ONCE — same value used to test and to save, so we
    // know what's saved is what was verified (no drift, no re-encrypt mismatch).
    const encryptedPass = encrypt(body.pass);
    const cfg = {
      host: body.host.trim(),
      port: body.port,
      user: body.user.trim(),
      encryptedPass,
      from: (body.from || body.user).trim(),
    };

    const result = await verifySmtp(cfg);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error, saved: false });
    }

    // Verification passed — persist if asked (default).
    let saved = false;
    if (body.persistOnSuccess) {
      const [c] = await db.select().from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
      if (!c) return NextResponse.json({ success: false, error: 'Company not found', saved: false }, { status: 404 });

      if (c.emailMode === 'shared') {
        // Shared mailbox — only admins can change it.
        await requireCompanyAdmin();
        await db.update(companies)
          .set({ smtpConfig: cfg, updatedAt: new Date() })
          .where(eq(companies.id, ctx.companyId));
      } else {
        // Per-rep — write to this user's record.
        await db.update(users)
          .set({ smtpConfig: cfg, updatedAt: new Date() })
          .where(eq(users.id, ctx.user.id));
      }
      saved = true;
    }

    return NextResponse.json({ success: true, saved });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message, saved: false }, { status: 400 });
  }
}
