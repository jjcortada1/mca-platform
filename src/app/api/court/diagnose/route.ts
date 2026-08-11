import { NextResponse } from 'next/server';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { diagnose } from '@/lib/court/ny-webcivil';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/court/diagnose — fetch the court search page and report the
 * form it exposes.
 *
 * The court site cannot be reached from every environment, and its markup
 * changes without notice. This turns "court search isn't working" into a
 * concrete answer: whether the site is reachable from THIS server, and
 * exactly which fields the form has today. Admin-only, since it reveals
 * outbound connectivity.
 */
export async function GET() {
  try {
    await requireCompanyAdmin();
    return NextResponse.json({ data: await diagnose() });
  } catch (e) { return apiError(e); }
}
