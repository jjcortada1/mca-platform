import { NextResponse } from 'next/server';
import { getRawSql } from '@/lib/db/client';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/storage — how much database storage each company uses,
 * plus the total.
 *
 * Method: for every table that carries a company_id column (discovered from
 * information_schema, so new tables are picked up automatically), sum
 * pg_column_size(row) grouped by company. A few large CHILD tables that
 * don't carry company_id directly (worksheet rows, deal offers, submission
 * funders/emails, funder contacts) are attributed through their parent.
 * Numbers are row-data estimates — indexes and internal overhead live in
 * the database total, which is the real pg_database_size.
 *
 * Access: company admins see their own company; master admins see every
 * company plus the platform total.
 */

// Child tables attributed through a parent join: [child, parentTable, childFk]
const CHILD_JOINS: [string, string, string][] = [
  ['worksheet_rows', 'worksheets', 'worksheet_id'],
  ['deal_offers', 'deals', 'deal_id'],
  ['submission_funders', 'submissions', 'submission_id'],
  ['submission_emails', 'submissions', 'submission_id'],
  ['funder_contacts', 'funders', 'funder_id'],
];

const IDENT = /^[a-z_][a-z0-9_]*$/;

export async function GET() {
  try {
    const ctx = await requireCompanyAdmin();
    const isMaster = ctx.user.role === 'master_admin';
    const sql = getRawSql();

    // Discover every table with a company_id column.
    const tableRows = (await sql`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'company_id'
    `) as unknown as { table_name: string }[];
    const tables = tableRows.map((r) => r.table_name).filter((t) => IDENT.test(t));

    // bytes[companyId][table] and rows[companyId]
    const byCompany = new Map<string, { bytes: number; rows: number; tables: Record<string, number> }>();
    const bump = (cid: string, table: string, bytes: number, rows: number) => {
      const cur = byCompany.get(cid) ?? { bytes: 0, rows: 0, tables: {} };
      cur.bytes += bytes;
      cur.rows += rows;
      cur.tables[table] = (cur.tables[table] ?? 0) + bytes;
      byCompany.set(cid, cur);
    };

    for (const t of tables) {
      // Identifier-safe (regex-validated, sourced from information_schema).
      const rows = await sql.unsafe(
        `SELECT company_id::text AS cid, COUNT(*)::bigint AS n,
                COALESCE(SUM(pg_column_size(t.*)), 0)::bigint AS bytes
         FROM "${t}" t WHERE company_id IS NOT NULL GROUP BY company_id`
      );
      for (const r of rows) bump(r.cid, t, Number(r.bytes), Number(r.n));
    }

    for (const [child, parent, fk] of CHILD_JOINS) {
      if (!IDENT.test(child) || !IDENT.test(parent) || !IDENT.test(fk)) continue;
      try {
        const rows = await sql.unsafe(
          `SELECT p.company_id::text AS cid, COUNT(*)::bigint AS n,
                  COALESCE(SUM(pg_column_size(c.*)), 0)::bigint AS bytes
           FROM "${child}" c JOIN "${parent}" p ON p.id = c."${fk}"
           WHERE p.company_id IS NOT NULL GROUP BY p.company_id`
        );
        for (const r of rows) bump(r.cid, child, Number(r.bytes), Number(r.n));
      } catch { /* table absent on this install — skip */ }
    }

    // Company names + real database total.
    const companies = await sql`SELECT id::text AS id, name FROM companies` as unknown as { id: string; name: string }[];
    const nameOf = new Map(companies.map((c) => [c.id, c.name]));
    const [{ total }] = await sql`SELECT pg_database_size(current_database())::bigint AS total`;

    let list = Array.from(byCompany.entries()).map(([cid, v]) => ({
      companyId: cid,
      companyName: nameOf.get(cid) ?? 'Unknown company',
      bytes: v.bytes,
      rows: v.rows,
      // Top 6 tables by size for the breakdown view.
      topTables: Object.entries(v.tables).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([table, bytes]) => ({ table, bytes })),
    })).sort((a, b) => b.bytes - a.bytes);

    // Company admins only see their own company (no cross-tenant sizes).
    if (!isMaster) list = list.filter((c) => c.companyId === ctx.companyId);

    return NextResponse.json({
      data: {
        companies: list,
        attributedBytes: list.reduce((s, c) => s + c.bytes, 0),
        databaseTotalBytes: isMaster ? Number(total) : null,
        note: 'Per-company numbers are row-data estimates; the database total also includes indexes and internal overhead.',
      },
    });
  } catch (e) { return apiError(e); }
}
