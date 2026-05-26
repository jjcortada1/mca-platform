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

const fullUpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  email: z.string().email().toLowerCase().trim().optional(),
  role: z.enum(['company_admin', 'rep']).optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
  // Optional — only changes the password when a non-empty value is sent
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  // Full user update (name/email/role/isActive/permissions/password).
  // Password is only changed when a non-empty value is provided.
  try {
    const ctx = await requireCompanyAdmin();
    const body = fullUpdateSchema.parse(await req.json());

    const [target] = await db.select().from(users)
      .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId))).limit(1);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // If email is changing, ensure it's not taken by someone else
    if (body.email && body.email !== target.email) {
      const [clash] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      if (clash) return NextResponse.json({ error: 'Email already in use' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.email !== undefined) updates.email = body.email;
    if (body.role !== undefined) updates.role = body.role;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.password) updates.passwordHash = await bcrypt.hash(body.password, 12);

    if (Object.keys(updates).length) {
      updates.updatedAt = new Date();
      await db.update(users).set(updates)
        .where(and(eq(users.id, params.id), eq(users.companyId, ctx.companyId)));
    }

    if (body.permissions !== undefined) {
      await db.delete(permissions).where(eq(permissions.userId, params.id));
      if (body.permissions.length) {
        await db.insert(permissions).values(
          body.permissions.map((k) => ({ userId: params.id, permissionKey: k }))
        );
      }
    }

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
