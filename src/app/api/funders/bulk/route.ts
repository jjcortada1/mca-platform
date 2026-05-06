import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  funders, funderTiers, funderTierAssignments, funderContacts,
  funderRestrictedStates, funderRestrictedIndustries,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { z } from 'zod';

/**
 * Bulk-import funders from CSV.
 *
 * Expected CSV columns (header required, order flexible):
 *   name, tiers, submission_method, supports_reverse_consolidation,
 *   min_revenue, max_positions, min_credit_tier, restricted_states,
 *   restricted_industries, notes,
 *   contact_name_1, contact_email_1, contact_phone_1,
 *   contact_name_2, contact_email_2, contact_phone_2 (optional)
 *
 * Returns: { ok: number, failed: number, errors: [{row, message}], created: [name] }
 */

const CREDIT_TIERS = ['unknown', 'under_550', '550_599', '600_649', '650_plus'] as const;
const SUBMISSION_METHODS = ['email', 'portal'] as const;

const rowSchema = z.object({
  name: z.string().min(1, 'name is required'),
  tiers: z.string().optional(),
  submission_method: z.enum(SUBMISSION_METHODS).optional(),
  supports_reverse_consolidation: z.string().optional(),
  min_revenue: z.string().optional(),
  max_positions: z.string().optional(),
  min_credit_tier: z.enum(CREDIT_TIERS).optional(),
  restricted_states: z.string().optional(),
  restricted_industries: z.string().optional(),
  notes: z.string().optional(),
  contact_name_1: z.string().optional(),
  contact_email_1: z.string().optional(),
  contact_phone_1: z.string().optional(),
  contact_name_2: z.string().optional(),
  contact_email_2: z.string().optional(),
  contact_phone_2: z.string().optional(),
  contact_name_3: z.string().optional(),
  contact_email_3: z.string().optional(),
  contact_phone_3: z.string().optional(),
});

type RawRow = z.infer<typeof rowSchema>;

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[]; errors: string[] } {
  const errors: string[] = [];
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // Tiny CSV parser that handles quotes
  const lines: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; continue; }
      if (c === '"') { inQuote = false; continue; }
      cell += c;
    } else {
      if (c === '"') { inQuote = true; continue; }
      if (c === ',') { cur.push(cell); cell = ''; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        cur.push(cell);
        if (cur.some((x) => x.trim() !== '')) lines.push(cur);
        cur = [];
        cell = '';
        continue;
      }
      cell += c;
    }
  }
  if (cell || cur.length) {
    cur.push(cell);
    if (cur.some((x) => x.trim() !== '')) lines.push(cur);
  }

  if (lines.length === 0) return { headers: [], rows: [], errors: ['Empty file'] };

  const headers = lines[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).map((lineCols) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (lineCols[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows, errors };
}

function parseList(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
}

function parseBool(s: string | undefined, def = false): boolean {
  if (!s) return def;
  const v = s.toLowerCase().trim();
  if (['true', 'yes', 'y', '1'].includes(v)) return true;
  if (['false', 'no', 'n', '0'].includes(v)) return false;
  return def;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('funders.edit');

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const text = await file.text();
    const { headers, rows, errors: parseErrors } = parseCSV(text);

    if (parseErrors.length) {
      return NextResponse.json({ error: parseErrors.join('; ') }, { status: 400 });
    }
    if (!headers.includes('name')) {
      return NextResponse.json({ error: 'CSV must include a "name" column' }, { status: 400 });
    }

    // Preload all tiers for this company so we can map names → ids
    const existingTiers = await db
      .select()
      .from(funderTiers)
      .where(eq(funderTiers.companyId, ctx.companyId));
    const tierByName = new Map(existingTiers.map((t) => [t.name.toLowerCase(), t]));

    const created: string[] = [];
    const rowErrors: { row: number; message: string }[] = [];
    let okCount = 0;

    for (let idx = 0; idx < rows.length; idx++) {
      const rawRow = rows[idx];
      const rowNum = idx + 2; // header is row 1
      try {
        const parsed = rowSchema.parse(rawRow) as RawRow;
        if (!parsed.name?.trim()) continue;

        // Resolve tiers — auto-create new tiers that don't exist yet
        const tierNames = parseList(parsed.tiers);
        const tierIds: string[] = [];
        for (const tn of tierNames) {
          let t = tierByName.get(tn.toLowerCase());
          if (!t) {
            const [created] = await db.insert(funderTiers).values({
              companyId: ctx.companyId,
              name: tn,
              sortOrder: existingTiers.length + tierByName.size,
            }).returning();
            t = created;
            tierByName.set(tn.toLowerCase(), t);
          }
          tierIds.push(t.id);
        }

        const submissionMethod = parsed.submission_method ?? 'email';
        const minCreditTier = parsed.min_credit_tier ?? 'unknown';
        const minRevenue = String(parseFloat(parsed.min_revenue || '0') || 0);
        const maxPositions = parseInt(parsed.max_positions || '99') || 99;
        const supportsRev = parseBool(parsed.supports_reverse_consolidation);

        // Insert funder
        const [funder] = await db.insert(funders).values({
          companyId: ctx.companyId,
          name: parsed.name.trim(),
          submissionMethod,
          supportsReverseConsolidation: supportsRev,
          minRevenue,
          maxPositions,
          minCreditTier,
          notes: parsed.notes?.trim() || null,
          isActive: true,
        }).returning();

        // Tier assignments
        if (tierIds.length) {
          await db.insert(funderTierAssignments).values(
            tierIds.map((tid) => ({ funderId: funder.id, tierId: tid }))
          ).onConflictDoNothing();
        }

        // Contacts (1-3)
        const contactsToInsert: { funderId: string; name: string; email: string | null; phone: string | null; isPrimary: boolean; sortOrder: number }[] = [];
        for (let cn = 1; cn <= 3; cn++) {
          const name = (parsed as any)[`contact_name_${cn}`]?.trim();
          const email = (parsed as any)[`contact_email_${cn}`]?.trim();
          const phone = (parsed as any)[`contact_phone_${cn}`]?.trim();
          if (name || email || phone) {
            contactsToInsert.push({
              funderId: funder.id,
              name: name || email || `Contact ${cn}`,
              email: email || null,
              phone: phone || null,
              isPrimary: cn === 1,
              sortOrder: cn - 1,
            });
          }
        }
        if (contactsToInsert.length) {
          await db.insert(funderContacts).values(contactsToInsert);
        }

        // Restricted states
        const states = parseList(parsed.restricted_states).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
        if (states.length) {
          await db.insert(funderRestrictedStates).values(
            states.map((s) => ({ funderId: funder.id, stateCode: s }))
          ).onConflictDoNothing();
        }

        // Restricted industries
        const industries = parseList(parsed.restricted_industries);
        if (industries.length) {
          await db.insert(funderRestrictedIndustries).values(
            industries.map((i) => ({ funderId: funder.id, industry: i }))
          ).onConflictDoNothing();
        }

        created.push(funder.name);
        okCount++;
      } catch (e) {
        const msg = e instanceof z.ZodError
          ? e.errors.map((er) => `${er.path.join('.')}: ${er.message}`).join('; ')
          : (e as Error).message;
        rowErrors.push({ row: rowNum, message: msg });
      }
    }

    return NextResponse.json({
      ok: okCount,
      failed: rowErrors.length,
      total: rows.length,
      errors: rowErrors,
      created,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/**
 * GET — returns the CSV template as a downloadable file.
 */
export async function GET() {
  const headers = [
    'name',
    'tiers',
    'submission_method',
    'supports_reverse_consolidation',
    'min_revenue',
    'max_positions',
    'min_credit_tier',
    'restricted_states',
    'restricted_industries',
    'notes',
    'contact_name_1', 'contact_email_1', 'contact_phone_1',
    'contact_name_2', 'contact_email_2', 'contact_phone_2',
    'contact_name_3', 'contact_email_3', 'contact_phone_3',
  ];

  const exampleRow = [
    'Velocity Capital',
    'A-Paper;Subprime',
    'email',
    'true',
    '25000',
    '3',
    '600_649',
    'CA;NY',
    'Cannabis / CBD;Adult Entertainment',
    'Fast funder, decisions same-day',
    'Sarah Lee', 'sarah@velocitycap.com', '555-123-4567',
    'Mike Chen', 'submissions@velocitycap.com', '',
    '', '', '',
  ];

  const csv =
    headers.join(',') + '\n' +
    exampleRow.map((c) => (c.includes(',') || c.includes('"') ? `"${c.replace(/"/g, '""')}"` : c)).join(',') + '\n' +
    '# Notes:\n' +
    '# - "tiers", "restricted_states", "restricted_industries" use ; or | as separator\n' +
    '# - "supports_reverse_consolidation" accepts true/false/yes/no/1/0\n' +
    '# - "min_credit_tier" must be one of: unknown, under_550, 550_599, 600_649, 650_plus\n' +
    '# - "submission_method" must be: email or portal\n' +
    '# - "min_revenue" is a number (no $ or commas)\n' +
    '# - States must be 2-letter codes (CA, NY, etc.)\n' +
    '# - Tiers that don\'t exist will be created automatically\n' +
    '# - Up to 3 contacts per funder; first is set as primary\n';

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="funders_template.csv"',
    },
  });
}
