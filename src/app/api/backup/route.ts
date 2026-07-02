import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { dataBackups, companies } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { gatherCompanyBackup, backupToJson, toCsv, CSV_DATASETS } from '@/lib/backup/export';
import { createBackupSnapshot, ensureAutoBackup } from '@/lib/backup/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Excel opens UTF-8 CSV correctly only with a byte-order mark.
const BOM = '﻿';

function filenameSafe(s: string): string {
  return (s || 'backup').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'backup';
}

/**
 * GET /api/backup
 *   ?list=1                    → JSON: automatic/manual snapshot history + settings
 *   ?snapshot=<id>             → download a stored snapshot (JSON file)
 *   ?format=json               → download a fresh full backup (JSON file)
 *   ?format=csv&dataset=deals  → download one dataset as CSV
 * Admin-only, always scoped to the caller's own company.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId } = await requireCompanyAdmin();
    const url = new URL(req.url);

    // Opportunistic: make sure today's automatic snapshot exists whenever an
    // admin touches the backup surface (cheap no-op when not due).
    await ensureAutoBackup(companyId);

    // ---- snapshot history + settings ----
    if (url.searchParams.get('list') === '1') {
      const rows = await db
        .select({
          id: dataBackups.id,
          kind: dataBackups.kind,
          byteSize: dataBackups.byteSize,
          rowCounts: dataBackups.rowCounts,
          createdAt: dataBackups.createdAt,
        })
        .from(dataBackups)
        .where(eq(dataBackups.companyId, companyId))
        .orderBy(desc(dataBackups.createdAt))
        .limit(30);
      const [company] = await db
        .select({
          autoBackupEnabled: companies.autoBackupEnabled,
          backupEmail: companies.backupEmail,
          lastBackupAt: companies.lastBackupAt,
        })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      return NextResponse.json({
        data: rows,
        datasets: CSV_DATASETS,
        settings: {
          autoBackupEnabled: company?.autoBackupEnabled ?? true,
          backupEmail: company?.backupEmail ?? null,
          lastBackupAt: company?.lastBackupAt ?? null,
        },
      });
    }

    // ---- download a stored snapshot ----
    const snapshotId = url.searchParams.get('snapshot');
    if (snapshotId) {
      const [snap] = await db
        .select()
        .from(dataBackups)
        .where(and(eq(dataBackups.id, snapshotId), eq(dataBackups.companyId, companyId)))
        .limit(1);
      if (!snap) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const date = new Date(snap.createdAt).toISOString().slice(0, 10);
      return new NextResponse(snap.content, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="backup-${date}.json"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const format = url.searchParams.get('format');

    // ---- one dataset as CSV ----
    if (format === 'csv') {
      const dataset = url.searchParams.get('dataset') || '';
      const all = await gatherCompanyBackup(companyId);
      const ds = all.find((d) => d.key === dataset);
      if (!ds) return NextResponse.json({ error: 'Unknown dataset' }, { status: 400 });
      const date = new Date().toISOString().slice(0, 10);
      return new NextResponse(BOM + toCsv(ds.rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filenameSafe(dataset)}-${date}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // ---- full backup as JSON (default) ----
    const all = await gatherCompanyBackup(companyId);
    const createdAtIso = new Date().toISOString();
    const json = backupToJson(companyId, all, createdAtIso);
    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="full-backup-${createdAtIso.slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * POST /api/backup — create a snapshot right now ("Back up now").
 * Admin-only, scoped to the caller's company.
 */
export async function POST() {
  try {
    const { companyId } = await requireCompanyAdmin();
    const result = await createBackupSnapshot(companyId, 'manual');
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    return apiError(e);
  }
}

const settingsSchema = z.object({
  autoBackupEnabled: z.boolean().optional(),
  // Empty string clears it; otherwise must be a valid email.
  backupEmail: z.union([z.string().email().max(320), z.literal(''), z.null()]).optional(),
});

/**
 * PUT /api/backup — update this company's backup settings (auto on/off +
 * optional off-site email destination). Admin-only.
 */
export async function PUT(req: NextRequest) {
  try {
    const { companyId } = await requireCompanyAdmin();
    const body = settingsSchema.parse(await req.json());
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.autoBackupEnabled !== undefined) patch.autoBackupEnabled = body.autoBackupEnabled;
    if (body.backupEmail !== undefined) {
      patch.backupEmail = body.backupEmail && body.backupEmail.length > 0 ? body.backupEmail.toLowerCase() : null;
    }
    await db.update(companies).set(patch).where(eq(companies.id, companyId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
