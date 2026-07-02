import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { titleCaseName } from '@/lib/utils';
import { fromDateInput } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bulk import FUNDED DEALS from CSV.
 *
 *   GET                    → download a simple CSV template
 *   POST (preview=1)       → parse + return rows for a confirmation/mapping step
 *   POST (commit)          → create the deals
 *
 * Headers are alias-tolerant (Deal/Merchant/Business/Funded Amount/Rep …) so
 * exports from other tools import without renaming columns. Only a deal name
 * OR a merchant name is required per row.
 */

const HEADER_ALIASES: Record<string, string> = {
  deal: 'name', deal_name: 'name', name: 'name',
  merchant: 'merchant_name', merchant_name: 'merchant_name', owner: 'merchant_name',
  first_name: 'merchant_first', last_name: 'merchant_last',
  email: 'merchant_email', merchant_email: 'merchant_email',
  phone: 'merchant_phone', merchant_phone: 'merchant_phone',
  business: 'business_name', business_name: 'business_name', company: 'business_name',
  funded: 'funded_amount', funded_amount: 'funded_amount', amount: 'funded_amount', funding: 'funded_amount',
  factor: 'factor_rate', factor_rate: 'factor_rate', rate: 'factor_rate',
  fee: 'fee_pct', fee_pct: 'fee_pct',
  term: 'term_count', term_count: 'term_count',
  term_mode: 'term_mode', frequency: 'term_mode',
  funding_date: 'funding_date', funded_date: 'funding_date', date: 'funding_date',
  rep: 'rep', rep_name: 'rep', rep_email: 'rep_email',
  notes: 'notes',
};

function normalizeHeader(raw: string): string {
  const h = raw.trim().toLowerCase().replace(/\s+/g, '_');
  return HEADER_ALIASES[h] ?? h;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines: string[][] = [];
  let cur: string[] = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; continue; }
      if (c === '"') { inQ = false; continue; }
      cell += c;
    } else {
      if (c === '"') { inQ = true; continue; }
      if (c === ',') { cur.push(cell); cell = ''; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        cur.push(cell);
        if (cur.some((x) => x.trim() !== '') && !cur[0].startsWith('#')) lines.push(cur);
        cur = []; cell = ''; continue;
      }
      cell += c;
    }
  }
  if (cell || cur.length) { cur.push(cell); if (cur.some((x) => x.trim() !== '') && !cur[0].startsWith('#')) lines.push(cur); }
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].map(normalizeHeader);
  const rows = lines.slice(1).map((cols) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (cols[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows };
}

const num = (s: string | undefined) => {
  if (!s) return null;
  const n = parseFloat(s.replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('deals.edit');
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const commit = form.get('commit') === '1';
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'File too large (>10MB).' }, { status: 413 });

    const { rows } = parseCSV(await file.text());
    if (!rows.length) return NextResponse.json({ error: 'No rows found in the file.' }, { status: 400 });
    if (rows.length > 5000) return NextResponse.json({ error: 'Too many rows (max 5000).' }, { status: 413 });

    // Roster for rep name/email → id resolution.
    const roster = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users).where(eq(users.companyId, ctx.companyId));
    const repByName = new Map(roster.map((r) => [r.name.toLowerCase(), r.id]));
    const repByEmail = new Map(roster.map((r) => [r.email.toLowerCase(), r.id]));

    // Normalize each row into a deal-shaped object + a human preview.
    const prepared = rows.map((r, idx) => {
      const merchant = (r.merchant_name || '').trim();
      const [mfFromFull = '', ...mrest] = merchant.split(' ');
      const merchantFirst = (r.merchant_first || mfFromFull || '').trim();
      const merchantLast = (r.merchant_last || mrest.join(' ') || '').trim();
      const name = (r.name || '').trim() || [merchantFirst, merchantLast].filter(Boolean).join(' ') || r.business_name || '';
      const repId = r.rep ? repByName.get(r.rep.toLowerCase()) ?? null
        : r.rep_email ? repByEmail.get(r.rep_email.toLowerCase()) ?? null : null;
      return {
        row: idx + 2,
        valid: !!name,
        data: {
          name,
          merchantFirstName: merchantFirst ? titleCaseName(merchantFirst) : null,
          merchantLastName: merchantLast ? titleCaseName(merchantLast) : null,
          merchantEmail: r.merchant_email || null,
          merchantPhone: r.merchant_phone || null,
          fundedAmount: num(r.funded_amount),
          factorRate: num(r.factor_rate),
          feePct: num(r.fee_pct),
          termCount: num(r.term_count),
          termMode: (r.term_mode || '').toLowerCase().includes('day') ? 'daily'
            : (r.term_mode || '').toLowerCase().includes('week') ? 'weekly' : null,
          fundingDate: r.funding_date || null,
          assignedRepId: repId,
          repLabel: r.rep || r.rep_email || null,
          notes: r.notes || null,
        },
      };
    });

    // Preview: return what WILL be created so the user can confirm/map.
    if (!commit) {
      return NextResponse.json({
        preview: true,
        total: prepared.length,
        valid: prepared.filter((p) => p.valid).length,
        rows: prepared.slice(0, 200),
      });
    }

    // Commit: insert the valid rows as FUNDED deals.
    let created = 0;
    const errors: { row: number; message: string }[] = [];
    for (const p of prepared) {
      if (!p.valid) { errors.push({ row: p.row, message: 'Missing deal/merchant name' }); continue; }
      const d = p.data;
      try {
        await db.insert(deals).values({
          companyId: ctx.companyId,
          name: d.name,
          merchantFirstName: d.merchantFirstName,
          merchantLastName: d.merchantLastName,
          merchantEmail: d.merchantEmail,
          merchantPhone: d.merchantPhone,
          status: 'funded',
          fundedAmount: d.fundedAmount != null ? String(d.fundedAmount) : null,
          factorRate: d.factorRate != null ? String(d.factorRate) : null,
          feePct: d.feePct != null ? String(d.feePct) : null,
          termCount: d.termCount != null ? String(d.termCount) : null,
          termMode: d.termMode,
          fundingDate: d.fundingDate ? (fromDateInput(d.fundingDate) ?? null) : null,
          assignedRepId: d.assignedRepId,
          fundedNotes: d.notes,
          createdBy: ctx.user.id,
        });
        created++;
      } catch (e) {
        errors.push({ row: p.row, message: e instanceof Error ? e.message : 'Insert failed' });
      }
    }
    return NextResponse.json({ ok: true, created, failed: errors.length, errors });
  } catch (e) { return apiError(e); }
}

export async function GET() {
  const csv = [
    'deal,merchant,business,email,phone,funded_amount,factor_rate,fee_pct,term_count,term_mode,funding_date,rep,notes',
    'Acme refi,John Smith,Acme LLC,john@acme.com,555-1234,100000,1.30,5,26,weekly,2026-06-01,Jane Rep,Clean file',
    '',
    '# Only a deal name OR a merchant name is required. Everything else is optional.',
    '# funded_amount/factor_rate/fee_pct/term_count are plain numbers.',
    '# term_mode: daily or weekly. funding_date: YYYY-MM-DD.',
    '# rep: match by rep name or email; unmatched reps are left unassigned.',
    '# Column names are flexible (Deal, Merchant, Business, Funded Amount, Rate, Fee, Term, Rep …).',
  ].join('\n') + '\n';
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="funded_deals_template.csv"' },
  });
}
