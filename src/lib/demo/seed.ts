/**
 * Demo mode — a complete, fake copy of the CRM for showing people around.
 *
 * ─────────────────────────────────────────────────────────────────────
 * HOW IT STAYS SAFE
 * Demo data lives in its own COMPANY row. Every query in the app is
 * already scoped by company_id through requireTenantContext, so turning
 * demo mode on simply points that one function at the demo company.
 * Real data is never read, written, hidden, or copied — it is just not
 * the company being looked at. Turning demo off is the same switch back.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Nothing here is derived from real records: every merchant, funder,
 * amount and date is generated, so a screen-share can never leak a real
 * client's name or numbers.
 *
 * The generator is SEEDED (deterministic) so the same demo company always
 * looks the same — a demo that reshuffles itself between screen-shares is
 * disconcerting to present.
 *
 * EVERY value written here is checked against src/lib/db/schema.ts. That
 * is not fussiness: a single bad enum member or missing NOT NULL column
 * makes the whole insert throw, and the only symptom the operator sees is
 * a toggle that does nothing.
 */

import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { db } from '@/lib/db/client';
import {
  companies, users, funders, funderContacts, deals, submissions,
  submissionFunders, dealCommissions, fundedEntries, infoEntries, tasks,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const DEMO_COMPANY_NAME = 'Northwind Capital (Demo)';

/** Slug is UNIQUE company-wide, so it has to be derived from the owner. */
function demoSlug(userId: string): string {
  return `demo-${userId.replace(/-/g, '').slice(0, 12)}`;
}

/** Demo logins are unreachable — the password is random and thrown away. */
function unusablePasswordHash(): string {
  return bcrypt.hashSync(randomBytes(24).toString('hex'), 10);
}

/* ───────────────────── deterministic randomness ───────────────────── */

/** Mulberry32 — tiny seeded PRNG so the demo is reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Marcus', 'Elena', 'Devon', 'Priya', 'Tomas', 'Rachel', 'Andre', 'Nina', 'Curtis', 'Yara', 'Bruno', 'Simone', 'Hector', 'Lila', 'Owen', 'Farrah'];
const LAST = ['Whitaker', 'Alvarez', 'Brooks', 'Nadeem', 'Ferreira', 'Kohl', 'Baptiste', 'Petrov', 'Hollis', 'Mansour', 'Castellano', 'Duarte', 'Vance', 'Okafor', 'Kerrigan', 'Silva'];
const BUSINESS = [
  'Ironline Freight', 'Harborview Diner', 'Sunset Auto Body', 'Cedar & Pine Contracting',
  'Bluewater HVAC', 'Copper Kettle Catering', 'Northgate Dental', 'Rapid Print Solutions',
  'Vista Landscaping', 'Union Street Barbers', 'Meridian Staffing', 'Stonebridge Plumbing',
  'Lakeshore Logistics', 'Golden Spoon Bakery', 'Pinnacle Roofing', 'Riverbend Fitness',
  'Atlas Machine Works', 'Willow Creek Florist', 'Summit Tire & Lube', 'Beacon IT Services',
];
const STATES = ['FL', 'NY', 'TX', 'CA', 'NJ', 'GA', 'IL', 'PA', 'OH', 'NC'];
const INDUSTRIES = ['transportation', 'restaurant', 'construction', 'retail', 'healthcare', 'auto', 'staffing', 'other'];

const DEMO_REPS = [
  'Alex Rendon', 'Jordan Feld', 'Camille Ortiz', 'Wes Trahan',
];

const DEMO_FUNDERS = [
  'Kestrel Advance', 'Meridian Funding Group', 'Blue Harbor Capital', 'Ironwood Advance',
  'Sable Ridge Funding', 'Vantage Point Capital', 'Copperline Advance', 'Northstar Business Capital',
  'Cascade Funding Partners', 'Ember Capital Group', 'Redwood Advance', 'Tidewater Capital',
];

/**
 * Pipeline statuses — every one of these is a real member of `deal_status`
 * in schema.ts. Note there is NO 'approved': the modern equivalent is
 * 'offer' (an offer is in hand) / 'waiting_on_offer'.
 */
const DEAL_STATUSES = ['submitted', 'waiting_on_offer', 'offer', 'active', 'funded', 'declined'] as const;
type DemoDealStatus = (typeof DEAL_STATUSES)[number];

/** The only members of `submission_funder_status`. */
const SUB_FUNDER_STATUSES = ['no_response', 'declined'] as const;

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)];
}
function between(r: () => number, lo: number, hi: number): number {
  return Math.round(lo + r() * (hi - lo));
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

/* ───────────────────────── the seeder ───────────────────────── */

export interface DemoSeedResult {
  companyId: string;
  created: boolean;
  counts: Record<string, number>;
}

/**
 * Create (or reuse) this user's demo company and fill it with fake data.
 *
 * Idempotent: if the user already has a demo company, it is returned
 * as-is rather than duplicated. Reset is a separate, explicit action.
 */
export async function ensureDemoCompany(userId: string, existingId: string | null): Promise<DemoSeedResult> {
  if (existingId) {
    const [existing] = await db.select().from(companies).where(eq(companies.id, existingId)).limit(1);
    if (existing) {
      return { companyId: existing.id, created: false, counts: {} };
    }
  }

  const slug = demoSlug(userId);

  // A previous attempt can leave an orphaned demo company behind (the row
  // lands, a later insert fails, nothing is recorded on the user). The slug
  // is unique, so that orphan would block every retry forever. Clear it —
  // guarded on the demo name so this can never touch a real company.
  const [orphan] = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);
  if (orphan) {
    if (orphan.name !== DEMO_COMPANY_NAME || orphan.isPlatformOwner) {
      throw new Error('A non-demo company already owns the demo slug; refusing to touch it.');
    }
    await db.delete(companies).where(eq(companies.id, orphan.id));
  }

  const r = rng(20260813);

  const [company] = await db.insert(companies).values({
    name: DEMO_COMPANY_NAME,
    slug,
    // Never the platform owner — the demo must not unlock master screens.
    isPlatformOwner: false,
    emailMode: 'per_rep',
  }).returning();

  const counts: Record<string, number> = {};

  /* ── Demo staff ──
     The funded board, commissions and assignment pickers all join to
     users, so a company with no users looks broken rather than empty.
     These accounts cannot be signed into: the password is random bytes
     that are hashed and immediately discarded. */
  const staffRows = await db.insert(users).values(
    DEMO_REPS.map((name, i) => ({
      companyId: company.id,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@northwind-demo.invalid`,
      passwordHash: unusablePasswordHash(),
      name,
      role: (i === 0 ? 'company_admin' : 'rep') as 'company_admin' | 'rep',
      twoFactorEnabled: false,
      isActive: true,
    })),
  ).returning();
  counts.users = staffRows.length;

  /* ── Funders ── */
  const funderRows = await db.insert(funders).values(
    DEMO_FUNDERS.map((name, i) => ({
      companyId: company.id,
      name,
      submissionMethod: 'email' as const,
      minRevenue: String(between(r, 10, 60) * 1000),
      maxPositions: between(r, 1, 4),
      supportsReverseConsolidation: i % 4 === 0,
      emails: [`submissions@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`],
      notes: 'Demo funder — not a real company.',
      isActive: true,
    })),
  ).returning();
  counts.funders = funderRows.length;

  await db.insert(funderContacts).values(
    funderRows.slice(0, 8).map((f, i) => ({
      funderId: f.id,
      name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      email: `rep@${f.name.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`,
      phone: `555-01${between(r, 10, 99)}`,
      isPrimary: true,
      sortOrder: i,
    })),
  );

  /* ── Deals across every stage of the pipeline ── */
  const dealRows: { id: string; status: DemoDealStatus; name: string; funded: number; repId: string }[] = [];

  for (let i = 0; i < 22; i++) {
    const first = pick(r, FIRST);
    const last = pick(r, LAST);
    const biz = BUSINESS[i % BUSINESS.length];
    const status: DemoDealStatus = i < 6 ? 'funded' : pick(r, DEAL_STATUSES);
    const funded = between(r, 15, 180) * 1000;
    const factor = 1.15 + Math.round(r() * 35) / 100;
    const rep = staffRows[i % staffRows.length];

    const [d] = await db.insert(deals).values({
      companyId: company.id,
      name: `${first} ${last} — ${biz} (${pick(r, STATES)})`,
      merchantFirstName: first,
      merchantLastName: last,
      merchantEmail: `${first.toLowerCase()}@${biz.toLowerCase().replace(/[^a-z]+/g, '')}.example.com`,
      merchantPhone: `555-0${between(r, 100, 999)}`,
      offerNotes: `${pick(r, INDUSTRIES)} · ${between(r, 30, 400)}K monthly revenue · ${between(r, 0, 3)} positions`,
      assignedRepId: rep.id,
      status,
      ...(status === 'funded'
        ? {
            fundedAmount: String(funded),
            netAmount: String(Math.round(funded * 0.9)),
            feePct: '10.000',
            factorRate: factor.toFixed(4),
            termMode: r() > 0.5 ? 'daily' : 'weekly',
            termCount: String(between(r, 60, 140)),
            fundingDate: daysAgo(between(r, 5, 200)),
            amountCollected: String(Math.round(funded * factor * (r() * 0.6))),
            fundedSubStatus: 'active',
          }
        : {}),
    }).returning();
    dealRows.push({ id: d.id, status, name: d.name, funded, repId: rep.id });
  }
  counts.deals = dealRows.length;

  /* ── Submissions on the shopping pipeline ──
     `submissions.deal_id` is UNIQUE, so at most one per deal. */
  let submissionCount = 0;
  for (const d of dealRows.filter((x) => x.status === 'submitted' || x.status === 'offer' || x.status === 'waiting_on_offer').slice(0, 8)) {
    const [sub] = await db.insert(submissions).values({
      dealId: d.id,
      companyId: company.id,
    }).returning();
    const chosen = funderRows.slice(0, between(r, 3, 7));
    await db.insert(submissionFunders).values(
      chosen.map((f, idx) => {
        const approved = idx === 0 && d.status === 'offer';
        return {
          submissionId: sub.id,
          funderId: f.id,
          status: (approved ? 'approved' : pick(r, SUB_FUNDER_STATUSES)) as 'approved' | 'no_response' | 'declined',
          notes: approved
            ? `Approved ${between(r, 20, 120)}K @ ${(1.2 + r() * 0.3).toFixed(2)}`
            : null,
        };
      }),
    );
    submissionCount++;
  }
  counts.submissions = submissionCount;

  /* ── Commissions + funded board ── */
  const fundedDeals = dealRows.filter((x) => x.status === 'funded');
  for (const d of fundedDeals) {
    const gross = Math.round(d.funded * 0.11);
    const repPct = 40;
    const repAmt = Math.round(gross * (repPct / 100));
    await db.insert(dealCommissions).values({
      companyId: company.id,
      dealId: d.id,
      repId: d.repId,
      fundedAmount: String(d.funded),
      rate: '1.3500',
      termMode: 'daily',
      termCount: '100',
      grossCommission: String(gross),
      repSplitPct: String(repPct),
      repCommissionAmount: String(repAmt),
      paidAmount: String(r() > 0.5 ? repAmt : 0),
      status: r() > 0.4 ? 'cleared' : 'pending',
      fundingDate: daysAgo(between(r, 5, 180)),
    });
    await db.insert(fundedEntries).values({
      companyId: company.id,
      repId: d.repId,
      dealInitials: d.name.split(' ').slice(0, 2).map((w) => w[0]).join(''),
      amountFunded: String(d.funded),
      fundedWith: pick(r, DEMO_FUNDERS),
      fundedDate: daysAgo(between(r, 5, 180)),
      notes: 'Demo funded deal.',
    });
  }
  counts.commissions = fundedDeals.length;

  /* ── Tasks + an info entry so those screens aren't empty ──
     `tasks` has no isDone column — the lifecycle lives in `status`
     ('open' | 'handling' | 'completed'). */
  await db.insert(tasks).values(
    ['Chase bank statements for Ironline Freight',
     'Follow up with Kestrel Advance on the Harborview file',
     'Send renewal offer to Sunset Auto Body',
     'Collect signed contract — Cedar & Pine',
     'Review stips for Bluewater HVAC'].map((title, i) => ({
      companyId: company.id,
      title,
      assignedToUserId: staffRows[i % staffRows.length].id,
      status: i > 3 ? 'completed' : 'open',
      completedAt: i > 3 ? daysAgo(between(r, 1, 20)) : null,
      dueDate: daysAgo(-between(r, 1, 14)),
    })),
  );
  counts.tasks = 5;

  await db.insert(infoEntries).values({
    companyId: company.id,
    title: 'Demo mode',
    body: 'Everything in this company is generated sample data — merchants, funders, amounts and dates are all fictional. Nothing here touches real records. Turn demo mode off in Settings to return to the live company.',
    category: 'General',
  });

  return { companyId: company.id, created: true, counts };
}

/**
 * Delete the demo company and everything in it.
 *
 * Safe by construction: it only ever targets a company id stored on the
 * user's own demo_company_id, and every child table cascades from the
 * company row.
 */
export async function destroyDemoCompany(companyId: string): Promise<void> {
  const [row] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!row) return;
  // Belt and braces: never delete anything that isn't the demo company.
  if (row.name !== DEMO_COMPANY_NAME || row.isPlatformOwner) return;
  await db.delete(companies).where(eq(companies.id, companyId));
}

/** Is this company a demo company? Used to render the banner. */
export async function isDemoCompany(companyId: string): Promise<boolean> {
  const [row] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  return Boolean(row && row.name === DEMO_COMPANY_NAME);
}
