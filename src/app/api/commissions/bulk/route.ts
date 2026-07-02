import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, users, dealCommissions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bulk import COMMISSIONS from CSV. Each row is matched to an existing deal
 * by name (within the company); a commission record is created/updated for
 * that deal. Rows whose deal can't be matched are reported and skipped.
 *
 *   GET              → template
 *   POST             → preview (what will be created, with match status)
 *   POST commit=1    → write
 */

const ALIASES: Record<string, string> = {
  deal: 'deal', deal_name: 'deal', name: 'deal',
  rep: 'rep', rep_name: 'rep', rep_email: 'rep_email',
  funded: 'funded_amount', funded_amount: 'funded_amount', amount: 'funded_amount',
  rate: 'rate', factor: 'rate', factor_rate: 'rate',
  gross: 'gross_commission', gross_commission: 'gross_commission', commission: 'gross_commission',
  split: 'rep_split_pct', rep_split: 'rep_split_pct', rep_split_pct: 'rep_split_pct',
  rep_commission: 'rep_commission_amount', rep_commission_amount: 'rep_commission_amount',
  broker_fee: 'broker_fee', fees: 'fees', notes: 'notes',
};
const norm = (h: string) => { const k = h.trim().toLowerCase().replace(/\s+/g, '_'); return ALIASES[k] ?? k; };
const num = (s: string | undefined) => { if (!s) return null; const n = parseFloat(s.replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : null; };

function parseCSV(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines: string[][] = [];
  let cur: string[] = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(cell); if (cur.some((x) => x.trim()) && !cur[0].startsWith('#')) lines.push(cur); cur = []; cell = ''; }
    else cell += c;
  }
  if (cell || cur.length) { cur.push(cell); if (cur.some((x) => x.trim()) && !cur[0].startsWith('#')) lines.push(cur); }
  if (!lines.length) return [];
  const headers = lines[0].map(norm);
  return lines.slice(1).map((cols) => { const o: Record<string, string> = {}; headers.forEach((h, i) => { o[h] = (cols[i] ?? '').trim(); }); return o; });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('commissions.manage');
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const commit = form.get('commit') === '1';
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const rows = parseCSV(await file.text());
    if (!rows.length) return NextResponse.json({ error: 'No rows found.' }, { status: 400 });

    const dealRows = await db.select({ id: deals.id, name: deals.name }).from(deals).where(eq(deals.companyId, ctx.companyId));
    const dealByName = new Map(dealRows.map((d) => [d.name.toLowerCase().trim(), d.id]));
    const roster = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.companyId, ctx.companyId));
    const repByName = new Map(roster.map((r) => [r.name.toLowerCase(), r.id]));
    const repByEmail = new Map(roster.map((r) => [r.email.toLowerCase(), r.id]));

    const prepared = rows.map((r, idx) => {
      const dealId = dealByName.get((r.deal || '').toLowerCase().trim()) ?? null;
      const repId = r.rep ? repByName.get(r.rep.toLowerCase()) ?? null : r.rep_email ? repByEmail.get(r.rep_email.toLowerCase()) ?? null : null;
      return {
        row: idx + 2,
        valid: !!dealId,
        data: {
          deal: r.deal || '', dealId, repId, repLabel: r.rep || r.rep_email || null,
          fundedAmount: num(r.funded_amount), rate: num(r.rate),
          grossCommission: num(r.gross_commission), repSplitPct: num(r.rep_split_pct),
          repCommissionAmount: num(r.rep_commission_amount), brokerFee: num(r.broker_fee),
          fees: num(r.fees), notes: r.notes || null,
          matched: dealId ? 'matched' : 'no deal match',
        },
      };
    });

    if (!commit) {
      return NextResponse.json({ preview: true, total: prepared.length, valid: prepared.filter((p) => p.valid).length, rows: prepared.slice(0, 200) });
    }

    let created = 0;
    const errors: { row: number; message: string }[] = [];
    for (const p of prepared) {
      if (!p.valid || !p.data.dealId) { errors.push({ row: p.row, message: `No deal matching "${p.data.deal}"` }); continue; }
      const d = p.data;
      try {
        await db.insert(dealCommissions).values({
          companyId: ctx.companyId,
          dealId: d.dealId,
          repId: d.repId,
          fundedAmount: d.fundedAmount != null ? String(d.fundedAmount) : null,
          rate: d.rate != null ? String(d.rate) : null,
          grossCommission: d.grossCommission != null ? String(d.grossCommission) : '0',
          repSplitPct: d.repSplitPct != null ? String(d.repSplitPct) : '0',
          repCommissionAmount: d.repCommissionAmount != null ? String(d.repCommissionAmount) : '0',
          brokerFee: d.brokerFee != null ? String(d.brokerFee) : null,
          fees: d.fees != null ? String(d.fees) : null,
          notes: d.notes,
        }).onConflictDoNothing();
        created++;
      } catch (e) { errors.push({ row: p.row, message: e instanceof Error ? e.message : 'Insert failed' }); }
    }
    return NextResponse.json({ ok: true, created, failed: errors.length, errors });
  } catch (e) { return apiError(e); }
}

export async function GET() {
  const csv = [
    'deal,rep,funded_amount,rate,gross_commission,rep_split_pct,rep_commission_amount,broker_fee,notes',
    'Acme refi,Jane Rep,100000,1.30,12000,30,3600,5000,',
    '',
    '# "deal" must match an existing deal name in your company (case-insensitive).',
    '# rep matches by name or email; unmatched reps are left blank.',
    '# All money/rate fields are plain numbers. Rows with no matching deal are skipped.',
  ].join('\n') + '\n';
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="commissions_template.csv"' } });
}
