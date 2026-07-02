import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db/client';
import {
  companies, users, funderTiers, funders, funderTierAssignments,
  funderContacts, funderRestrictedStates, funderRestrictedIndustries,
  commissionRules, structuredEmailFields, masterDefaultFunders, matchOptions,
} from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { requireMasterAdmin } from '@/lib/auth/context';
import { createCompanySchema } from '@/lib/validation/schemas';
import { handle, ok, created, badRequest } from '@/lib/api/response';
import { DEFAULT_COMMISSION_RULES } from '@/lib/calculator/mca';
import { titleCaseName } from '@/lib/utils';

/**
 * GET — list all companies (master admin only).
 * Returns name, slug, user count, funder count, created. NEVER deal data.
 */
export const GET = handle(async () => {
  await requireMasterAdmin();
  const list = await db.select().from(companies).orderBy(companies.createdAt);

  const enriched = await Promise.all(
    list.map(async (c) => {
      const [u] = await db.select({ c: count() }).from(users).where(eq(users.companyId, c.id));
      const [f] = await db.select({ c: count() }).from(funders).where(eq(funders.companyId, c.id));
      return {
        id: c.id, name: c.name, slug: c.slug,
        emailMode: c.emailMode, isActive: c.isActive, createdAt: c.createdAt,
        userCount: u?.c ?? 0, funderCount: f?.c ?? 0,
        isPlatformOwner: c.isPlatformOwner,
        enabledNavItems: (c.enabledNavItems as string[] | null) ?? null,
      };
    })
  );
  return ok(enriched);
});

/**
 * POST — create a new company.
 * Provisions: company row, company_admin user, default tiers, seeded funders
 *   from masterDefaultFunders, default commission rules.
 */
export const POST = handle(async (req: NextRequest) => {
  await requireMasterAdmin();
  const body = await req.json();
  const parsed = createCompanySchema.parse(body);

  // Slug uniqueness check
  const [existing] = await db.select().from(companies).where(eq(companies.slug, parsed.slug)).limit(1);
  if (existing) return badRequest('A company with that slug already exists.');

  // Email uniqueness check (across all users globally)
  const [existingUser] = await db.select().from(users).where(eq(users.email, parsed.adminEmail)).limit(1);
  if (existingUser) return badRequest('A user with that email already exists.');

  // Create company
  const [company] = await db.insert(companies).values({
    name: parsed.name,
    slug: parsed.slug,
    emailMode: 'per_rep',
  }).returning();

  // Create admin user
  const passwordHash = await bcrypt.hash(parsed.adminPassword, 12);
  await db.insert(users).values({
    companyId: company.id,
    email: parsed.adminEmail,
    name: titleCaseName(parsed.adminName),
    passwordHash,
    role: 'company_admin',
  });

  // Seed default commission rules
  await db.insert(commissionRules).values(
    DEFAULT_COMMISSION_RULES.map((r, i) => ({
      companyId: company.id,
      threshold: String(r.threshold),
      commissionPct: String(r.commissionPct),
      sortOrder: i,
    }))
  );

  // Seed default structured fields (common ones brokers use)
  await db.insert(structuredEmailFields).values([
    { companyId: company.id, fieldLabel: 'Balances', fieldKey: 'balances', sortOrder: 0 },
    { companyId: company.id, fieldLabel: 'Daily/Weekly', fieldKey: 'daily_weekly', sortOrder: 1 },
    { companyId: company.id, fieldLabel: 'Asking', fieldKey: 'asking', sortOrder: 2 },
  ]);

  // Match options (credit ranges, revenue ranges, industries, positions,
  // deal types) power the Shop & Submit deal-profile dropdowns. New
  // companies inherit them so their reps aren't staring at empty dropdowns:
  // from the copy-source company when copying funders, otherwise from the
  // platform-owner company's configured set.
  const optionsSource = (parsed.funderSeedMode === 'copy' && parsed.copyFromCompanyId)
    ? parsed.copyFromCompanyId
    : (await db.select({ id: companies.id }).from(companies)
        .where(eq(companies.isPlatformOwner, true)).limit(1))[0]?.id ?? null;
  if (optionsSource) await cloneMatchOptions(optionsSource, company.id);

  // Seed the funder directory per the chosen mode:
  //   'none'   → leave empty, they bring their own list
  //   'copy'   → clone a source company's live funders (tiers, contacts,
  //              restrictions, submission emails — everything)
  //   'master' → clone master default funders (legacy default)
  if (parsed.funderSeedMode === 'copy' && parsed.copyFromCompanyId) {
    await cloneCompanyFunders(parsed.copyFromCompanyId, company.id);
    return created({ id: company.id, slug: company.slug });
  }
  if (parsed.funderSeedMode === 'none') {
    return created({ id: company.id, slug: company.slug });
  }

  // Seed funders from master defaults (if any exist)
  const masterFunders = await db.select().from(masterDefaultFunders);
  if (masterFunders.length) {
    // Build tier name → tier ID map
    const tierNames = new Set<string>();
    for (const mf of masterFunders) {
      const payload = mf.payload as { tiers?: string[] } | null;
      payload?.tiers?.forEach((t) => tierNames.add(t));
    }
    const tierRows = await db.insert(funderTiers).values(
      Array.from(tierNames).map((name, i) => ({ companyId: company.id, name, sortOrder: i }))
    ).returning();
    const tierByName = new Map(tierRows.map((t) => [t.name, t.id]));

    // Insert each funder + relations
    for (const mf of masterFunders) {
      const payload = mf.payload as {
        tiers?: string[];
        contacts?: { name: string; phone?: string; email?: string; isPrimary?: boolean }[];
        restrictedStates?: string[];
        restrictedIndustries?: string[];
      };
      const [funderRow] = await db.insert(funders).values({
        companyId: company.id,
        name: mf.name,
        submissionMethod: mf.submissionMethod,
        supportsReverseConsolidation: mf.supportsReverseConsolidation,
        minRevenue: mf.minRevenue,
        maxPositions: mf.maxPositions,
        minCreditTier: mf.minCreditTier,
        notes: mf.notes,
      }).returning();

      const tierIds = (payload?.tiers ?? []).map((n) => tierByName.get(n)).filter((id): id is string => Boolean(id));
      if (tierIds.length) {
        await db.insert(funderTierAssignments).values(
          tierIds.map((tierId) => ({ funderId: funderRow.id, tierId }))
        );
      }

      const contacts = payload?.contacts ?? [];
      if (contacts.length) {
        await db.insert(funderContacts).values(
          contacts.map((c, i) => ({
            funderId: funderRow.id,
            name: c.name,
            phone: c.phone ?? null,
            email: c.email ?? null,
            isPrimary: c.isPrimary ?? false,
            sortOrder: i,
          }))
        );
      }

      const states = payload?.restrictedStates ?? [];
      if (states.length) {
        await db.insert(funderRestrictedStates).values(
          states.map((stateCode) => ({ funderId: funderRow.id, stateCode }))
        );
      }

      const industries = payload?.restrictedIndustries ?? [];
      if (industries.length) {
        await db.insert(funderRestrictedIndustries).values(
          industries.map((industry) => ({ funderId: funderRow.id, industry }))
        );
      }
    }
  }

  return created({ id: company.id, slug: company.slug });
});

/**
 * Copy a company's match options (deal-profile dropdown values) into a new
 * company so shopping works out of the box. Independent copy — edits in
 * either company never affect the other.
 */
async function cloneMatchOptions(fromCompanyId: string, toCompanyId: string) {
  const rows = await db.select().from(matchOptions).where(eq(matchOptions.companyId, fromCompanyId));
  if (!rows.length) return;
  await db.insert(matchOptions).values(rows.map((r) => ({
    companyId: toCompanyId,
    kind: r.kind,
    value: r.value,
    label: r.label,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    meta: r.meta,
  })));
}

/**
 * Clone one company's ENTIRE live funder directory into another company:
 * tiers (with per-tier overrides), funders, contacts, restricted states,
 * restricted industries, and submission emails. Used when the master admin
 * hands a new company an existing list as their starting point. The copy is
 * independent — edits in either company never affect the other.
 */
async function cloneCompanyFunders(fromCompanyId: string, toCompanyId: string) {
  const srcTiers = await db.select().from(funderTiers).where(eq(funderTiers.companyId, fromCompanyId));
  const tierIdMap = new Map<string, string>();
  for (const t of srcTiers) {
    const [row] = await db.insert(funderTiers).values({
      companyId: toCompanyId, name: t.name, sortOrder: t.sortOrder,
    }).returning();
    tierIdMap.set(t.id, row.id);
  }

  const srcFunders = await db.select().from(funders).where(eq(funders.companyId, fromCompanyId));
  for (const f of srcFunders) {
    const [row] = await db.insert(funders).values({
      companyId: toCompanyId,
      name: f.name,
      submissionMethod: f.submissionMethod,
      supportsReverseConsolidation: f.supportsReverseConsolidation,
      minRevenue: f.minRevenue,
      maxPositions: f.maxPositions,
      minCreditTier: f.minCreditTier,
      emails: f.emails,
      phones: f.phones,
      notes: f.notes,
      plainSubjectOnly: f.plainSubjectOnly,
      isActive: f.isActive,
    }).returning();

    const assignments = await db.select().from(funderTierAssignments)
      .where(eq(funderTierAssignments.funderId, f.id));
    const mapped = assignments
      .filter((a) => tierIdMap.has(a.tierId))
      .map((a) => ({
        funderId: row.id,
        tierId: tierIdMap.get(a.tierId)!,
        maxPositions: a.maxPositions,
        minRevenue: a.minRevenue,
        minCreditTier: a.minCreditTier,
      }));
    if (mapped.length) await db.insert(funderTierAssignments).values(mapped);

    const contacts = await db.select().from(funderContacts).where(eq(funderContacts.funderId, f.id));
    if (contacts.length) {
      await db.insert(funderContacts).values(contacts.map((c) => ({
        funderId: row.id, name: c.name, role: c.role, phone: c.phone,
        email: c.email, isPrimary: c.isPrimary, sortOrder: c.sortOrder,
      })));
    }

    const states = await db.select().from(funderRestrictedStates).where(eq(funderRestrictedStates.funderId, f.id));
    if (states.length) {
      await db.insert(funderRestrictedStates).values(states.map((s) => ({
        funderId: row.id, stateCode: s.stateCode,
      })));
    }

    const industries = await db.select().from(funderRestrictedIndustries).where(eq(funderRestrictedIndustries.funderId, f.id));
    if (industries.length) {
      await db.insert(funderRestrictedIndustries).values(industries.map((i) => ({
        funderId: row.id, industry: i.industry,
      })));
    }
  }
}
