import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/client';
import { users, permissions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { updateUserSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireCompanyAdmin();
    const body = updateUserSchema.parse(await req.json());

    const [target] = await db.select().from(users)
      .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId))).limit(1);
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (Object.keys(updates).length) {
      updates.updatedAt = new Date();
      await db.update(users).set(updates)
        .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId)));
    }

    if (body.permissions !== undefined) {
      await db.delete(permissions).where(eq(permissions.userId, params.id));
      if (body.permissions.length) {
        await db.insert(permissions).values(body.permissions.map((k) => ({ userId: params.id, permissionKey: k })));
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

const passwordSchema = z.object({ password: z.string().min(10) });

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  // Admin password reset for a user
  try {
    const ctx = await requireCompanyAdmin();
    const body = passwordSchema.parse(await req.json());

    const [target] = await db.select().from(users)
      .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId))).limit(1);
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const hash = await bcrypt.hash(body.password, 12);
    await db.update(users).set({ passwordHash: hash, updatedAt: new Date() })
      .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireCompanyAdmin();
    if (params.id === ctx.user.id) {
      return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }
    await db.delete(users).where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId)));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
