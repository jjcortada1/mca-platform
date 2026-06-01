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

// Lowercase helper for forgiving enum matching.
const toLower = (s: unknown) => (typeof s === 'string' ? s.toLowerCase().trim() : s);

const rowSchema = z.object({
  // REQUIRED
  name: z.string().min(1, 'name is required'),
  tiers: z.string().optional(),
  // Forgiving — accepts "Email", "EMAIL", "email", " email " etc.
  submission_method: z.preprocess(toLower, z.enum(SUBMISSION_METHODS).optional()),
  // submission_email = where deals are SHOPPED to. Supports multiple values
  // separated by ; , or |.
  submission_email: z.string().optional(),
  // contact_* = a human contact for the funder. NEVER used for shopping deals.
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().optional(),
  notes: z.string().optional(),

  // OPTIONAL ADVANCED
  supports_reverse_consolidation: z.string().optional(),
  min_revenue: z.string().optional(),
  // Forgiving — accepts "650_plus", "650 plus", "650+", etc.
  min_credit_tier: z.preprocess(
    (s) => {
      if (typeof s !== 'string') return s;
      const v = s.toLowerCase().trim().replace(/\s+/g, '_').replace(/\+/g, '_plus');
      return v || undefined;
    },
    z.enum(CREDIT_TIERS).optional()
  ),
  credit: z.string().optional(),
  max_positions: z.string().optional(),
  restricted_states: z.string().optional(),
  restricted_industries: z.string().optional(),
  additional_rules: z.string().optional(),
  // Multiple funder-level emails / phones (pipe- semi- or comma-separated)
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
    const updated: string[] = [];
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

        // Combine `notes` and `additional_rules` if both present
        const combinedNotes = [parsed.notes?.trim(), parsed.additional_rules?.trim()]
          .filter(Boolean)
          .join('\n');

        // funders.emails = where deals are SHOPPED to. Pulled from submission_email
        // (preferred — clearer intent) OR the legacy `emails` column if used.
        // Multiple values separated by ; , or |.
        const shoppingEmails = [
          ...parseList(parsed.submission_email || ''),
          ...parseList(parsed.emails || ''),
        ]
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e && e.includes('@'));
        const dedupedShoppingEmails = Array.from(new Set(shoppingEmails));
        const phones = parseList(parsed.phones || '').filter(Boolean);

        // UPSERT: if a funder with this name exists, UPDATE it in place.
        // Otherwise INSERT new. Re-uploading the same CSV with corrections is
        // the primary use case — we never want to "skip" a funder silently.
        const dupName = parsed.name.trim().toLowerCase();
        const [dupe] = await db.select().from(funders)
          .where(and(eq(funders.companyId, ctx.companyId), sql`lower(${funders.name}) = ${dupName}`))
          .limit(1);

        let funder: typeof funders.$inferSelect;
        const isUpdate = !!dupe;

        if (dupe) {
          // UPDATE — replace base fields. For arrays (emails/phones) we MERGE
          // (existing + new, deduped) so a partial re-upload never wipes data.
          const mergedEmails = Array.from(new Set([
            ...((dupe.emails as string[] | null) ?? []),
            ...dedupedShoppingEmails,
          ]));
          const mergedPhones = Array.from(new Set([
            ...((dupe.phones as string[] | null) ?? []),
            ...phones,
          ]));
          const [updated] = await db.update(funders).set({
            submissionMethod,
            supportsReverseConsolidation: supportsRev,
            minRevenue,
            maxPositions,
            minCreditTier,
            emails: mergedEmails.length ? mergedEmails : null,
            phones: mergedPhones.length ? mergedPhones : null,
            // Append new notes if any; don't overwrite existing notes.
            notes: combinedNotes
              ? (dupe.notes ? `${dupe.notes}\n${combinedNotes}` : combinedNotes)
              : dupe.notes,
            updatedAt: new Date(),
          }).where(eq(funders.id, dupe.id)).returning();
          funder = updated;
        } else {
          // INSERT new funder
          const [created] = await db.insert(funders).values({
            companyId: ctx.companyId,
            name: parsed.name.trim(),
            submissionMethod,
            supportsReverseConsolidation: supportsRev,
            minRevenue,
            maxPositions,
            minCreditTier,
            emails: dedupedShoppingEmails.length ? dedupedShoppingEmails : null,
            phones: phones.length ? phones : null,
            notes: combinedNotes || null,
            isActive: true,
          }).returning();
          funder = created;
        }

        // Tier assignments. Each tier can carry its own max_positions override
        // (per-tier "max_positions_TIERNAME" column). NULL = inherit from base.
        // onConflictDoUpdate so re-upload refreshes the per-tier overrides.
        if (tierIds.length) {
          // tierNames and tierIds align by index (we built tierIds in the same
          // order earlier). For each tier we look up a per-tier override column
          // with naming pattern `max_positions_<tiername>` (lowercased,
          // spaces → underscores). If absent, override = NULL.
          for (let ti = 0; ti < tierIds.length; ti++) {
            const tierId = tierIds[ti];
            const tierName = tierNames[ti];
            const overrideKey = `max_positions_${tierName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
            const overrideRaw = (rawRow as Record<string, string | undefined>)[overrideKey];
            const tierMaxPos = overrideRaw && overrideRaw.trim()
              ? parseInt(overrideRaw, 10) || null
              : null;
            await db.insert(funderTierAssignments).values({
              funderId: funder.id,
              tierId,
              maxPositions: tierMaxPos,
              minRevenue: null,
              minCreditTier: null,
            }).onConflictDoUpdate({
              target: [funderTierAssignments.funderId, funderTierAssignments.tierId],
              set: { maxPositions: tierMaxPos },
            });
          }
        }

        // Contacts — humans tied to this funder. NEVER used for shopping (that's
        // what funders.emails is for). Stored so JJ has someone to call.
        // On UPDATE we leave existing contacts in place and only ADD new ones
        // that aren't already there (dedupe by name+email).
        const existingContacts = isUpdate
          ? await db.select().from(funderContacts).where(eq(funderContacts.funderId, funder.id))
          : [];
        const contactKey = (n: string | null, e: string | null) =>
          `${(n || '').toLowerCase().trim()}|${(e || '').toLowerCase().trim()}`;
        const existingContactKeys = new Set(existingContacts.map((c) => contactKey(c.name, c.email)));

        const contactsToInsert: { funderId: string; name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean; sortOrder: number }[] = [];

        function addContactIfNew(contact: { name: string; role: string | null; email: string | null; phone: string | null }) {
          const key = contactKey(contact.name, contact.email);
          if (existingContactKeys.has(key)) return;
          existingContactKeys.add(key);
          contactsToInsert.push({
            funderId: funder.id,
            name: contact.name,
            role: contact.role,
            email: contact.email,
            phone: contact.phone,
            isPrimary: existingContacts.length === 0 && contactsToInsert.length === 0,
            sortOrder: existingContacts.length + contactsToInsert.length,
          });
        }

        const simpleName = parsed.contact_name?.trim();
        const simplePhone = parsed.contact_phone?.trim();
        const simpleEmail = parsed.contact_email?.trim();
        if (simpleName || simplePhone || simpleEmail) {
          addContactIfNew({
            name: simpleName || simpleEmail || 'Primary contact',
            role: null,
            email: simpleEmail || null,
            phone: simplePhone || null,
          });
        }

        // Named role contacts (ISO rep / underwriter / funding manager)
        const roleDefs: { role: string; nameKey: string; emailKey: string; phoneKey: string }[] = [
          { role: 'iso_rep', nameKey: 'iso_rep', emailKey: 'iso_rep_email', phoneKey: 'iso_rep_phone' },
          { role: 'underwriter', nameKey: 'underwriter', emailKey: 'underwriter_email', phoneKey: 'underwriter_phone' },
          { role: 'funding_manager', nameKey: 'funding_manager', emailKey: 'funding_manager_email', phoneKey: 'funding_manager_phone' },
        ];
        for (const rd of roleDefs) {
          const name = (parsed as Record<string, string | undefined>)[rd.nameKey]?.trim();
          const email = (parsed as Record<string, string | undefined>)[rd.emailKey]?.trim();
          const phone = (parsed as Record<string, string | undefined>)[rd.phoneKey]?.trim();
          if (name || email || phone) {
            addContactIfNew({
              name: name || email || rd.role.replace('_', ' '),
              role: rd.role,
              email: email || null,
              phone: phone || null,
            });
          }
        }

        // Also pick up legacy contact_name_N columns (still supported for back-compat)
        for (let cn = 1; cn <= 3; cn++) {
          const name = (parsed as Record<string, string | undefined>)[`contact_name_${cn}`]?.trim();
          const email = (parsed as Record<string, string | undefined>)[`contact_email_${cn}`]?.trim();
          const phone = (parsed as Record<string, string | undefined>)[`contact_phone_${cn}`]?.trim();
          if (name || email || phone) {
            addContactIfNew({
              name: name || email || `Contact ${cn}`,
              role: null,
              email: email || null,
              phone: phone || null,
            });
          }
        }

        // FALLBACK: if no human contact was provided (in the upload AND in
        // existing contacts), use each submission email as a default
        // "Primary contact". This satisfies the rule: "if there is no
        // contact information, the default contact should just be the email."
        if (existingContacts.length === 0 && contactsToInsert.length === 0 && dedupedShoppingEmails.length) {
          for (const em of dedupedShoppingEmails) {
            addContactIfNew({
              name: em,
              role: null,
              email: em,
              phone: null,
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

        if (isUpdate) updated.push(funder.name);
        else created.push(funder.name);
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
      updated,
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
    'submissions@acmefunding.com',     // submission_email (one)
    '',                                // contact_name (optional)
    '',                                // contact_phone
    '',                                // contact_email
    '',                                // notes
    // empty optional fields = no restriction
    '', '', '', '', '', '', '',
  ];

  // Sample 2: multiple submission emails + multiple tiers
  const fullRow = [
    'Velocity Capital',                                                // name
    'A-Paper;Subprime',                                                // tiers — multiple separated by ;
    'email',                                                           // submission_method
    'submissions@velocitycap.com;intake@velocitycap.com',              // submission_email — multiple
    'Sarah Lee',                                                       // contact_name (separate; NOT used to shop deals)
    '555-123-4567',                                                    // contact_phone
    'sarah@velocitycap.com',                                           // contact_email
    'Fast funder, decisions same-day',                                 // notes
    '25000',                                                           // min_revenue (plain number)
    '600_649',                                                         // min_credit_tier
    '3',                                                               // max_positions
    'CA;NY',                                                           // restricted_states
    'Cannabis;Adult Entertainment',                                    // restricted_industries
    'TRUE',                                                            // supports_reverse_consolidation (TRUE/FALSE/yes/no/1/0)
    'No 1099 contractors; min 6 months in business',                   // additional_rules
  ];

  function csvRow(row: string[]) {
    return row.map((c) => (c.includes(',') || c.includes('"') || c.includes('\n') ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
  }

  const csv = [
    headers.join(','),
    csvRow(minimalRow),
    csvRow(fullRow),
    '',
    '# REQUIRED columns: only "name" must be filled.',
    '# All others are optional but encouraged.',
    '#',
    '# RE-UPLOAD = UPDATE:',
    '# - Re-uploading a CSV with a funder name that already exists will UPDATE',
    '#   that funder in place (not skip and not duplicate). Submission emails',
    '#   and phones are MERGED with what\'s already there — partial uploads',
    '#   never erase existing data. Notes get appended.',
    '#',
    '# IMPORTANT — how emails work:',
    '# - "submission_email" = where deals are sent when you shop them. You can list MULTIPLE',
    '#   addresses separated by ; or | (e.g. "submissions@x.com;intake@x.com"). Every',
    '#   address gets the email when you submit a deal.',
    '# - "contact_email" = a human contact (e.g. your ISO rep there). NEVER used for shopping.',
    '# - If you don\'t provide ANY contact info, each submission email is saved as a',
    '#   default contact so the funder card never looks empty.',
    '#',
    '# MULTIPLE TIERS WITH DIFFERENT RULES:',
    '# - "tiers" supports multiple values separated by ; or | (e.g. "A-Paper;Subprime").',
    '# - A funder will appear in every tier listed.',
    '# - Tiers that don\'t exist yet are created automatically.',
    '# - PER-TIER OVERRIDES: add columns named "max_positions_<tier>" to set a',
    '#   different max position count for that tier. Example: a funder might',
    '#   accept up to 2 positions in their "A-Paper" tier but up to 4 in',
    '#   "Subprime". Columns would be: max_positions_a_paper, max_positions_subprime.',
    '#   Spaces and dashes become underscores; the match is case-insensitive.',
    '# - The base "max_positions" applies to any tier that has no override.',
    '#',
    '# Other notes:',
    '# - "submission_method" accepts: email, portal (case-insensitive).',
    '# - "min_revenue" is a plain number (no $ or commas). Empty = no minimum.',
    '# - "min_credit_tier" must be one of: unknown, under_550, 550_599, 600_649, 650_plus.',
    '# - "max_positions" — empty = no max (defaults to 99).',
    '# - "restricted_states" — 2-letter codes separated by ; or | (e.g. "CA;NY").',
    '# - "restricted_industries" — names separated by ; or | (free text).',
    '# - "supports_reverse_consolidation" accepts TRUE/FALSE/yes/no/1/0.',
    '# - "additional_rules" — free text, appended to notes.',
    '# - You can upload .csv, .xlsx, or .xls. First sheet only for spreadsheets.',
  ].join('\n') + '\n';

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="funders_template.csv"',
    },
  });
}
