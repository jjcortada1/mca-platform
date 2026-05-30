import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  funders, funderTiers, funderTierAssignments, funderContacts,
  funderRestrictedStates, funderRestrictedIndustries,
} from '@/lib/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { z } from 'zod';
import * as XLSX from 'xlsx';

// Node runtime so large file uploads work (xlsx parsing is CPU-bound, not edge).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  // REQUIRED
  name: z.string().min(1, 'name is required'),
  tiers: z.string().optional(),
  submission_method: z.enum(SUBMISSION_METHODS).optional(),
  // NEW simplified — accept either submission_email or contact_email_1
  submission_email: z.string().optional(),
  // NEW simplified single-contact fields
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().optional(),
  notes: z.string().optional(),

  // OPTIONAL ADVANCED
  supports_reverse_consolidation: z.string().optional(),
  min_revenue: z.string().optional(),
  // Accept either snake_case or generic 'credit' label
  min_credit_tier: z.enum(CREDIT_TIERS).optional(),
  credit: z.string().optional(),
  max_positions: z.string().optional(),
  restricted_states: z.string().optional(),
  restricted_industries: z.string().optional(),
  additional_rules: z.string().optional(),
  // Multiple funder-level emails / phones (pipe- or comma-separated)
  emails: z.string().optional(),
  phones: z.string().optional(),
  // Named role contacts
  iso_rep: z.string().optional(),
  iso_rep_email: z.string().optional(),
  iso_rep_phone: z.string().optional(),
  underwriter: z.string().optional(),
  underwriter_email: z.string().optional(),
  underwriter_phone: z.string().optional(),
  funding_manager: z.string().optional(),
  funding_manager_email: z.string().optional(),
  funding_manager_phone: z.string().optional(),

  // LEGACY 1-3 contact columns — still supported
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

    // Accept .csv, .xlsx, .xls. Convert spreadsheets to CSV in-memory so the
    // existing parser handles them uniformly.
    const filename = (file.name || '').toLowerCase();
    let text: string;
    if (filename.endsWith('.xlsx') || filename.endsWith('.xls') ||
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.type === 'application/vnd.ms-excel') {
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: 'buffer' });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) return NextResponse.json({ error: 'Spreadsheet has no sheets' }, { status: 400 });
        const sheet = wb.Sheets[sheetName];
        text = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      } catch (err) {
        return NextResponse.json({
          error: 'Could not read spreadsheet. Make sure it is a valid .xlsx or .xls file.',
        }, { status: 400 });
      }
    } else {
      // CSV / plain text path
      text = await file.text();
    }

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

        // Duplicate detection — skip if a funder with this name already exists
        // for the company (case-insensitive).
        const dupName = parsed.name.trim().toLowerCase();
        const [dupe] = await db.select({ id: funders.id }).from(funders)
          .where(and(eq(funders.companyId, ctx.companyId), sql`lower(${funders.name}) = ${dupName}`))
          .limit(1);
        if (dupe) {
          rowErrors.push({ row: rowNum, message: `Skipped — funder "${parsed.name.trim()}" already exists` });
          continue;
        }

        // Combine `notes` and `additional_rules` if both present
        const combinedNotes = [parsed.notes?.trim(), parsed.additional_rules?.trim()]
          .filter(Boolean)
          .join('\n');

        // Multiple emails / phones (pipe- or comma-separated columns)
        const emails = parseList(parsed.emails || '').filter(Boolean);
        const phones = parseList(parsed.phones || '').filter(Boolean);

        // Insert funder
        const [funder] = await db.insert(funders).values({
          companyId: ctx.companyId,
          name: parsed.name.trim(),
          submissionMethod,
          supportsReverseConsolidation: supportsRev,
          minRevenue,
          maxPositions,
          minCreditTier,
          emails: emails.length ? emails : null,
          phones: phones.length ? phones : null,
          notes: combinedNotes || null,
          isActive: true,
        }).returning();

        // Tier assignments
        if (tierIds.length) {
          await db.insert(funderTierAssignments).values(
            tierIds.map((tid) => ({ funderId: funder.id, tierId: tid }))
          ).onConflictDoNothing();
        }

        // Contacts — accept simplified single-contact OR legacy 1-3 form
        // Priority: simplified contact_name/phone/email + submission_email become contact 1
        const contactsToInsert: { funderId: string; name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean; sortOrder: number }[] = [];

        const simpleName = parsed.contact_name?.trim();
        const simplePhone = parsed.contact_phone?.trim();
        const simpleEmail = parsed.contact_email?.trim() || parsed.submission_email?.trim();
        if (simpleName || simplePhone || simpleEmail) {
          contactsToInsert.push({
            funderId: funder.id,
            name: simpleName || simpleEmail || 'Primary contact',
            role: null,
            email: simpleEmail || null,
            phone: simplePhone || null,
            isPrimary: true,
            sortOrder: 0,
          });
        }

        // Named role contacts (ISO rep / underwriter / funding manager)
        const roleDefs: { role: string; nameKey: string; emailKey: string; phoneKey: string }[] = [
          { role: 'iso_rep', nameKey: 'iso_rep', emailKey: 'iso_rep_email', phoneKey: 'iso_rep_phone' },
          { role: 'underwriter', nameKey: 'underwriter', emailKey: 'underwriter_email', phoneKey: 'underwriter_phone' },
          { role: 'funding_manager', nameKey: 'funding_manager', emailKey: 'funding_manager_email', phoneKey: 'funding_manager_phone' },
        ];
        for (const rd of roleDefs) {
          const name = (parsed as any)[rd.nameKey]?.trim();
          const email = (parsed as any)[rd.emailKey]?.trim();
          const phone = (parsed as any)[rd.phoneKey]?.trim();
          if (name || email || phone) {
            contactsToInsert.push({
              funderId: funder.id,
              name: name || email || rd.role.replace('_', ' '),
              role: rd.role,
              email: email || null,
              phone: phone || null,
              isPrimary: contactsToInsert.length === 0,
              sortOrder: contactsToInsert.length,
            });
          }
        }

        // Also pick up legacy contact_name_N columns
        for (let cn = 1; cn <= 3; cn++) {
          const name = (parsed as any)[`contact_name_${cn}`]?.trim();
          const email = (parsed as any)[`contact_email_${cn}`]?.trim();
          const phone = (parsed as any)[`contact_phone_${cn}`]?.trim();
          if (name || email || phone) {
            contactsToInsert.push({
              funderId: funder.id,
              name: name || email || `Contact ${cn}`,
              role: null,
              email: email || null,
              phone: phone || null,
              isPrimary: contactsToInsert.length === 0,
              sortOrder: contactsToInsert.length,
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
    return apiError(e);
  }
}

/**
 * GET — returns the CSV template as a downloadable file.
 *
 * Two-row sample: a minimal one (only required) + a full one (with advanced fields).
 */
export async function GET() {
  // Required cols first, then optional. Order matches JJ's spec.
  const headers = [
    // REQUIRED
    'name',
    'tiers',
    'submission_method',
    'submission_email',
    'contact_name',
    'contact_phone',
    'contact_email',
    'notes',
    // OPTIONAL ADVANCED
    'min_revenue',
    'min_credit_tier',
    'max_positions',
    'restricted_states',
    'restricted_industries',
    'supports_reverse_consolidation',
    'additional_rules',
  ];

  // Sample 1: minimum required only
  const minimalRow = [
    'Acme Funding',                    // name
    'A-Paper',                         // tiers
    'email',                           // submission_method
    'submissions@acmefunding.com',     // submission_email
    '',                                // contact_name (optional)
    '',                                // contact_phone
    '',                                // contact_email
    '',                                // notes
    // empty optional fields = no restriction
    '', '', '', '', '', '', '',
  ];

  // Sample 2: full example with restrictions
  const fullRow = [
    'Velocity Capital',                              // name
    'A-Paper;Subprime',                              // tiers (semicolon-separated)
    'email',                                         // submission_method
    'submissions@velocitycap.com',                   // submission_email
    'Sarah Lee',                                     // contact_name
    '555-123-4567',                                  // contact_phone
    'sarah@velocitycap.com',                         // contact_email
    'Fast funder, decisions same-day',               // notes
    '25000',                                         // min_revenue
    '600_649',                                       // min_credit_tier
    '3',                                             // max_positions
    'CA;NY',                                         // restricted_states
    'Cannabis;Adult Entertainment',                  // restricted_industries
    'true',                                          // supports_reverse_consolidation
    'No 1099 contractors; min 6 months in business', // additional_rules
  ];

  function csvRow(row: string[]) {
    return row.map((c) => (c.includes(',') || c.includes('"') || c.includes('\n') ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
  }

  const csv = [
    headers.join(','),
    csvRow(minimalRow),
    csvRow(fullRow),
    '',
    '# REQUIRED columns (first 8): name, tiers, submission_method, submission_email,',
    '#                              contact_name, contact_phone, contact_email, notes',
    '# - Only "name" must be filled per row. The rest are encouraged but allowed empty.',
    '# - "tiers" is a list separated by ; or |  (e.g. "A-Paper;Subprime")',
    '# - "submission_method" must be: email or portal',
    '#',
    '# OPTIONAL ADVANCED columns:',
    '# - "min_revenue" is a plain number (no $ or commas). Leave empty = no minimum.',
    '# - "min_credit_tier" must be one of: unknown, under_550, 550_599, 600_649, 650_plus',
    '# - "max_positions" — leave empty for no max (defaults to 99)',
    '# - "restricted_states" — 2-letter codes separated by ; or |  (e.g. "CA;NY")',
    '# - "restricted_industries" — names separated by ; or | (free text, matches industries set in Settings → Match options)',
    '# - "supports_reverse_consolidation" accepts true/false/yes/no/1/0',
    '# - "additional_rules" — free text, appended to notes',
    '#',
    '# Tiers that don\'t exist will be created automatically.',
    '# Empty optional fields are treated as no restriction.',
  ].join('\n') + '\n';

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="funders_template.csv"',
    },
  });
}
