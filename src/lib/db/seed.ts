/**
 * Database seed script.
 *
 * BAKED-IN DEFAULTS for first-time setup (override with env vars):
 *   - Master admin:  jj@cortadacapitalgroup.com / Flinjcorta1
 *   - Company admin: jj@cortadacapitalgroup.com / Flinjcorta1 (same login, both roles available)
 *
 * Three layered behaviors:
 *   1. ALWAYS — bootstraps master admin and populates master_default_funders.
 *   2. ALWAYS in this build — creates a Cortada tenant company with the same admin.
 *   3. IF SEED_TEST_DATA=true — populates with sample funders, deals, submission, etc.
 *
 * Override defaults via env:
 *   MASTER_ADMIN_EMAIL              default: jj@cortadacapitalgroup.com
 *   MASTER_ADMIN_PASSWORD           default: Flinjcorta1
 *   SEED_COMPANY_NAME               default: Cortada Capital Group
 *   SEED_COMPANY_SLUG               default: cortada
 *   SEED_COMPANY_ADMIN_EMAIL        default: same as MASTER_ADMIN_EMAIL
 *   SEED_COMPANY_ADMIN_PASSWORD     default: same as MASTER_ADMIN_PASSWORD
 *   SEED_TEST_DATA                  default: true (set 'false' to skip)
 *   SEED_TEST_REP_EMAIL             default: rep@cortadacapitalgroup.com
 *   SEED_TEST_REP_PASSWORD          default: TestRep123!
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db } from './client';
import {
  companies,
  users,
  permissions,
  commissionRules,
  structuredEmailFields,
  masterDefaultFunders,
  funders,
  funderTiers,
  funderTierAssignments,
  funderContacts,
  funderRestrictedStates,
  funderRestrictedIndustries,
  deals,
  submissions,
  submissionFunders,
  submissionEmails,
  fundedEntries,
  infoEntries,
  PERMISSION_KEYS,
} from './schema';
import { eq } from 'drizzle-orm';
import { DEFAULT_COMMISSION_RULES } from '../calculator/mca';
import { DEFAULT_FUNDERS } from '../../../data/default-funders';

const DEFAULT_STRUCTURED_FIELDS = [
  { fieldLabel: 'Business Name', fieldKey: 'business_name' },
  { fieldLabel: 'Industry', fieldKey: 'industry' },
  { fieldLabel: 'State', fieldKey: 'state' },
  { fieldLabel: 'Monthly Revenue', fieldKey: 'monthly_revenue' },
  { fieldLabel: 'Time in Business', fieldKey: 'time_in_business' },
  { fieldLabel: 'Credit Score', fieldKey: 'credit_score' },
  { fieldLabel: 'Positions', fieldKey: 'positions' },
  { fieldLabel: 'Requested Amount', fieldKey: 'requested_amount' },
];

async function ensureMasterDefaultFunders() {
  const existing = await db.select().from(masterDefaultFunders);
  if (existing.length) {
    console.log(`• master_default_funders already populated (${existing.length})`);
    return;
  }
  await db.insert(masterDefaultFunders).values(
    DEFAULT_FUNDERS.map((f) => ({
      name: f.name,
      submissionMethod: f.submissionMethod,
      supportsReverseConsolidation: f.supportsReverseConsolidation,
      minRevenue: String(f.minRevenue),
      maxPositions: f.maxPositions,
      minCreditTier: f.minCreditTier,
      notes: f.notes ?? null,
      payload: {
        tiers: f.tiers,
        contacts: f.contacts,
        restrictedStates: f.restrictedStates,
        restrictedIndustries: f.restrictedIndustries,
      },
    }))
  );
  console.log(`✓ Seeded ${DEFAULT_FUNDERS.length} master default funders`);
}

async function ensureCompany(name: string, slug: string) {
  let [company] = await db.select().from(companies).where(eq(companies.slug, slug));
  if (company) {
    console.log(`• Company already exists: ${name} (${slug})`);
    return { company, isNew: false };
  }
  [company] = await db
    .insert(companies)
    .values({ name, slug, emailMode: 'per_rep' })
    .returning();
  console.log(`✓ Company created: ${name} (${slug})`);

  // Seed default commission rules
  await db.insert(commissionRules).values(
    DEFAULT_COMMISSION_RULES.map((r, i) => ({
      companyId: company.id,
      threshold: r.threshold.toString(),
      commissionPct: r.commissionPct.toString(),
      sortOrder: i,
    }))
  );
  console.log(`  ✓ Commission rules seeded`);

  // Seed default structured fields
  await db.insert(structuredEmailFields).values(
    DEFAULT_STRUCTURED_FIELDS.map((f, i) => ({ companyId: company.id, ...f, sortOrder: i }))
  );
  console.log(`  ✓ Structured email fields seeded`);

  return { company, isNew: true };
}

async function ensureCompanyAdmin(companyId: string, email: string, password: string) {
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length) {
    console.log(`• Company admin already exists: ${email}`);
    return existing[0];
  }
  const hash = await bcrypt.hash(password, 12);
  const [admin] = await db
    .insert(users)
    .values({
      companyId,
      email,
      passwordHash: hash,
      name: 'Company Admin',
      role: 'company_admin',
    })
    .returning();
  await db.insert(permissions).values(
    Object.values(PERMISSION_KEYS).map((key) => ({ userId: admin.id, permissionKey: key }))
  );
  console.log(`✓ Company admin created: ${email}`);
  return admin;
}

async function seedFundersFromDefaults(companyId: string) {
  // Skip if company already has funders
  const existing = await db.select({ id: funders.id }).from(funders).where(eq(funders.companyId, companyId));
  if (existing.length) {
    console.log(`• Company already has ${existing.length} funders — skipping funder seed`);
    return existing.map((f) => f.id);
  }

  // Build tier name → id map
  const tierNames = new Set<string>();
  for (const f of DEFAULT_FUNDERS) f.tiers.forEach((t) => tierNames.add(t));
  const tierRows = await db.insert(funderTiers).values(
    Array.from(tierNames).map((name, i) => ({ companyId, name, sortOrder: i }))
  ).returning();
  const tierByName = new Map(tierRows.map((t) => [t.name, t.id]));
  console.log(`  ✓ Created ${tierRows.length} funder tiers`);

  // Insert funders
  const inserted: string[] = [];
  for (const f of DEFAULT_FUNDERS) {
    const [funderRow] = await db.insert(funders).values({
      companyId,
      name: f.name,
      submissionMethod: f.submissionMethod,
      supportsReverseConsolidation: f.supportsReverseConsolidation,
      minRevenue: String(f.minRevenue),
      maxPositions: f.maxPositions,
      minCreditTier: f.minCreditTier,
      notes: f.notes ?? null,
    }).returning();
    inserted.push(funderRow.id);

    const tierIds = f.tiers.map((n) => tierByName.get(n)).filter((id): id is string => Boolean(id));
    if (tierIds.length) {
      await db.insert(funderTierAssignments).values(
        tierIds.map((tierId) => ({ funderId: funderRow.id, tierId }))
      );
    }
    if (f.contacts.length) {
      await db.insert(funderContacts).values(
        f.contacts.map((c, i) => ({
          funderId: funderRow.id,
          name: c.name,
          phone: c.phone ?? null,
          email: c.email ?? null,
          isPrimary: c.isPrimary ?? false,
          sortOrder: i,
        }))
      );
    }
    if (f.restrictedStates.length) {
      await db.insert(funderRestrictedStates).values(
        f.restrictedStates.map((stateCode) => ({ funderId: funderRow.id, stateCode }))
      );
    }
    if (f.restrictedIndustries.length) {
      await db.insert(funderRestrictedIndustries).values(
        f.restrictedIndustries.map((industry) => ({ funderId: funderRow.id, industry }))
      );
    }
  }
  console.log(`  ✓ Created ${inserted.length} funders with tiers, contacts, restrictions`);
  return inserted;
}

async function seedSampleWorkflow(
  companyId: string,
  adminId: string,
  repId: string,
  funderIds: string[]
) {
  // Skip if any deals exist
  const existingDeals = await db.select({ id: deals.id }).from(deals).where(eq(deals.companyId, companyId));
  if (existingDeals.length) {
    console.log(`• Company already has ${existingDeals.length} deals — skipping workflow seed`);
    return;
  }

  // 1. Sample deal — already submitted to 2 funders
  const [deal1] = await db.insert(deals).values({
    companyId,
    name: 'John Smith — Riverside Auto Repair (FL)',
    merchantFirstName: 'John',
    merchantLastName: 'Smith',
    merchantEmail: 'john@riversideauto.example.com',
    merchantPhone: '305-555-0142',
    offerNotes: 'Existing client. 1 active position with sample funder, paying down well. Looking for $50K consolidation + new working capital.',
    assignedRepId: repId,
    status: 'submitted',
    createdBy: repId,
  }).returning();
  console.log(`  ✓ Sample deal created: ${deal1.name}`);

  const [submission1] = await db.insert(submissions).values({
    dealId: deal1.id,
    companyId,
  }).returning();

  // Send to first 2 funders, with one already replied "approved"
  const [sf1] = await db.insert(submissionFunders).values({
    submissionId: submission1.id,
    funderId: funderIds[0],
    status: 'approved',
    notes: 'Approved $35K @ 1.42 over 100 business days. Daily $497.',
    submittedBy: repId,
  }).returning();
  const [sf2] = await db.insert(submissionFunders).values({
    submissionId: submission1.id,
    funderId: funderIds[1],
    status: 'no_response',
    submittedBy: repId,
  }).returning();

  // Email log entries (no real send, just record)
  await db.insert(submissionEmails).values([
    {
      submissionFunderId: sf1.id,
      toEmail: 'submissions@example-a.com',
      ccEmails: [],
      subject: `NEW DEAL | ${deal1.name}`,
      body: 'Sample deal. See attached merchant docs.',
      attachmentMeta: [{ name: 'bank_statements.pdf', size: 245000 }, { name: 'application.pdf', size: 18000 }],
      success: true,
      smtpResponse: '250 OK',
    },
    {
      submissionFunderId: sf2.id,
      toEmail: 'iso@example-b.com',
      ccEmails: [],
      subject: `NEW DEAL | ${deal1.name}`,
      body: 'Sample deal. See attached merchant docs.',
      attachmentMeta: [{ name: 'bank_statements.pdf', size: 245000 }, { name: 'application.pdf', size: 18000 }],
      success: true,
      smtpResponse: '250 OK',
    },
  ]);
  console.log(`  ✓ Sample submission with 2 funders (1 approved, 1 pending)`);

  // 2. Second deal — still in shopping
  await db.insert(deals).values({
    companyId,
    name: 'Maria Garcia — Sunrise Bakery (CA)',
    merchantFirstName: 'Maria',
    merchantLastName: 'Garcia',
    merchantEmail: 'maria@sunrisebakery.example.com',
    merchantPhone: '619-555-0177',
    offerNotes: 'New merchant. $80K monthly revenue, 2 positions, 620 credit. Looking for $40K.',
    assignedRepId: repId,
    status: 'shopping',
    createdBy: repId,
  });
  console.log(`  ✓ Second deal created (in shopping state)`);

  // 3. One funded entry on the funded board
  await db.insert(fundedEntries).values({
    companyId,
    repId,
    dealInitials: 'JS-RA',
    amountFunded: '35000.00',
    fundedDate: new Date(),
    notes: 'Sample funded deal for testing the funded board.',
  });
  console.log(`  ✓ Sample funded board entry`);

  // 4. One info entry
  await db.insert(infoEntries).values({
    companyId,
    title: 'Welcome to the MCA Platform',
    body: 'This is a sample knowledge-base entry. Use the Info section for funder docs, ISO agreements, internal SOPs, common deal-shopping notes, and anything else your team needs to reference. Click "+ New entry" to add your own.',
    category: 'General',
    createdBy: adminId,
  });
  console.log(`  ✓ Sample info entry`);
}

async function seed() {
  // ONE LOGIN — JJ has full control over everything. No separate master admin,
  // no separate rep. Company admin role grants access to all features including
  // master-admin features (creating new companies, managing master defaults).
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'jj@cortadacapitalgroup.com').toLowerCase().trim();
  const adminPass = process.env.SEED_ADMIN_PASSWORD ?? 'Flinjcorta1';
  const compName = process.env.SEED_COMPANY_NAME ?? 'Cortada Capital Group';
  const compSlug = process.env.SEED_COMPANY_SLUG ?? 'cortada';

  // Master defaults are created so future companies (if any) get pre-seeded funders
  await ensureMasterDefaultFunders();

  const { company } = await ensureCompany(compName, compSlug);
  const admin = await ensureCompanyAdmin(company.id, adminEmail, adminPass);

  // Sample workflow data (DEFAULT: enabled — disable with SEED_TEST_DATA=false)
  const seedTestData = process.env.SEED_TEST_DATA?.toLowerCase() !== 'false';
  if (seedTestData) {
    console.log('\n→ Populating sample workflow data');

    const funderIds = await seedFundersFromDefaults(company.id);
    if (funderIds.length >= 2) {
      // Pass admin.id as both creator and assigned rep — single user owns everything
      await seedSampleWorkflow(company.id, admin.id, admin.id, funderIds);
    } else {
      console.log('• Not enough funders to seed sample workflow (need 2+)');
    }

    console.log('\n════════════════════════════════════════════════════════');
    console.log('   LOGIN CREDENTIALS');
    console.log('════════════════════════════════════════════════════════');
    console.log(`     Email:    ${adminEmail}`);
    console.log(`     Password: ${adminPass}`);
    console.log('');
    console.log('   This single login has full control over everything.');
    console.log('════════════════════════════════════════════════════════');
  }

  console.log('\nDone.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
