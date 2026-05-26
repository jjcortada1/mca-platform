import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { companies, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireTenantContext, requireCompanyAdmin } from '@/lib/auth/context';
import { encrypt } from '@/lib/crypto';
import { z } from 'zod';
import { apiError } from '@/lib/api/errors';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  encryptedPass: string;
  from?: string;
  secure?: boolean;
}

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    const [c] = await db.select().from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    if (!c) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    if (c.emailMode === 'shared') {
      const cfg = c.smtpConfig as SmtpConfig | null;
      return NextResponse.json({
        data: {
          mode: 'shared',
          hasConfig: !!cfg,
          host: cfg?.host ?? '',
          port: cfg?.port ?? 587,
          user: cfg?.user ?? '',
          from: cfg?.from ?? '',
        },
      });
    }

    const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
    const cfg = (me?.smtpConfig as SmtpConfig | null) ?? null;
    return NextResponse.json({
      data: {
        mode: 'per_rep',
        hasConfig: !!cfg,
        host: cfg?.host ?? '',
        port: cfg?.port ?? 587,
        user: cfg?.user ?? '',
        from: cfg?.from ?? '',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1),
  pass: z.string().optional(),
  from: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const body = smtpSchema.parse(await req.json());
    const [c] = await db.select().from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    if (!c) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    if (c.emailMode === 'shared') {
      await requireCompanyAdmin();
      const existing = (c.smtpConfig as SmtpConfig | null) ?? null;
      if (!body.pass && !existing) {
        return NextResponse.json({ error: 'Password required' }, { status: 400 });
      }
      const newCfg: SmtpConfig = {
        host: body.host,
        port: body.port,
        user: body.user,
        encryptedPass: body.pass ? encrypt(body.pass) : existing!.encryptedPass,
        from: body.from || body.user,
      };
      await db.update(companies).set({ smtpConfig: newCfg, updatedAt: new Date() }).where(eq(companies.id, ctx.companyId));
    } else {
      const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const existing = (me?.smtpConfig as SmtpConfig | null) ?? null;
      if (!body.pass && !existing) {
        return NextResponse.json({ error: 'Password required' }, { status: 400 });
      }
      const newCfg: SmtpConfig = {
        host: body.host,
        port: body.port,
        user: body.user,
        encryptedPass: body.pass ? encrypt(body.pass) : existing!.encryptedPass,
        from: body.from || body.user,
      };
      await db.update(users).set({ smtpConfig: newCfg, updatedAt: new Date() }).where(eq(users.id, ctx.user.id));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireTenantContext();
    const [c] = await db.select().from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    if (!c) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    if (c.emailMode === 'shared') {
      await requireCompanyAdmin();
      await db.update(companies).set({ smtpConfig: null, updatedAt: new Date() }).where(eq(companies.id, ctx.companyId));
    } else {
      await db.update(users).set({ smtpConfig: null, updatedAt: new Date() }).where(eq(users.id, ctx.user.id));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
