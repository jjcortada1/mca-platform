import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { submissions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';

/**
 * DELETE /api/submissions/[id]
 * Permanently removes a submission and all its attached funder rows + emails
 * (cascaded by FK). Tenant-guarded — a submission outside the caller's company
 * is returned as 404 to avoid leaking existence.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission('deals.submit');

    const [sub] = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.id, params.id), eq(submissions.companyId, ctx.companyId)))
      .limit(1);
    if (!sub) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

    await db.delete(submissions).where(eq(submissions.id, params.id));
    return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
