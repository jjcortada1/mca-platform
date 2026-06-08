import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/* ---------- Enums ---------- */

export const userRoleEnum = pgEnum('user_role', ['master_admin', 'company_admin', 'rep', 'lead_source']);
export const submissionMethodEnum = pgEnum('submission_method', ['email', 'portal']);
export const dealTypeEnum = pgEnum('deal_type', ['standard_mca', 'reverse_consolidation']);
// NOTE: `shopping` and `dead` are LEGACY values kept for existing rows.
// New deals should use the modern set: submitted, active, not_active, offer, funded, declined.
export const dealStatusEnum = pgEnum('deal_status', [
  'shopping',     // legacy — displayed as "Submitted"
  'submitted',
  'active',
  'not_active',
  'offer',
  'funded',
  'dead',         // legacy — displayed as "Declined"
  'declined',
  // Simplified workflow (current)
  'waiting_on_offer',
  // Portfolio lifecycle statuses (additive)
  'payment_issues',
  'eligible_for_renewal',
  'default',
  'paid_off',
  'closed',
  'pending_funding',
  'renewal_sent',
  'in_collections',
  'on_hold',
]);
export const submissionFunderStatusEnum = pgEnum('submission_funder_status', [
  'no_response',
  'approved',
  'declined',
]);
export const creditTierEnum = pgEnum('credit_tier', ['unknown', 'under_550', '550_599', '600_649', '650_plus']);
export const emailModeEnum = pgEnum('email_mode', ['shared', 'per_rep']);

/* ---------- Tenancy ---------- */

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  emailMode: emailModeEnum('email_mode').notNull().default('per_rep'),
  // Encrypted SMTP config when emailMode = 'shared'. Format: { host, port, user, encryptedPass, from }
  smtpConfig: jsonb('smtp_config'),
  globalCcEmails: jsonb('global_cc_emails').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Branding — admin-configurable. Override "MCA Platform" defaults app-wide.
  productName: varchar('product_name', { length: 100 }),
  displayName: varchar('display_name', { length: 200 }),
  logoUrl: text('logo_url'),
  primaryColor: varchar('primary_color', { length: 30 }),  // HSL string e.g. "184 70% 22%"
  emailSignature: text('email_signature'),
  // Funded-email template — admin defines this once in Settings. Shape:
  // { subject: string, fields: [{ id, label, recommended? }], attachmentNote?: string }
  //  - subject: a fixed string used as the email subject ("Funded — {merchantName}").
  //    Reps can fill in {placeholders} when sending.
  //  - fields: ordered list of labeled inputs the rep fills in. Each becomes
  //    its own line in the body, stacked vertically: "Label: value".
  //  - attachmentNote: optional free text shown next to the attach-files UI
  //    to remind reps what to upload ("Statement of payoff, void check, etc.")
  fundedEmailTemplate: jsonb('funded_email_template'),
  // Sidebar order — array of nav item keys (the href strings) in the order
  // they should appear in the left nav. When set, this overrides the default
  // hardcoded order for EVERY user in the company (admin and rep alike) so
  // the menu looks the same for everyone. NULL = use the default order.
  sidebarOrder: jsonb('sidebar_order').$type<string[]>(),
  // Sidebar categories — when set, takes precedence over the flat order
  // above and groups items into named sections. Shape:
  //   [{ id: string, label: string, items: string[] }]
  // Each section's label is shown as a small header in the sidebar; items
  // are hrefs that the user has permission to access. Items NOT in any
  // section appear in an auto "Other" bucket at the bottom so future app
  // releases that add new nav items show up without an admin re-edit.
  sidebarCategories: jsonb('sidebar_categories').$type<{ id: string; label: string; items: string[] }[]>(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Users & Auth ---------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // null for master_admin; required for everyone else
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    role: userRoleEnum('role').notNull(),
    // Per-rep SMTP config when company.emailMode = 'per_rep'. Same shape as companies.smtpConfig.
    smtpConfig: jsonb('smtp_config'),
    // Per-rep "always CC" — when this user sends a deal email, this address
    // is automatically added to CC on every outbound message. Used by reps
    // who want their manager copied on everything. Empty = no auto CC.
    // NOTE: Funded emails (different flow) intentionally do NOT honor this.
    alwaysCcEmail: varchar('always_cc_email', { length: 255 }),
    // Per-rep email signature appended to outgoing emails this rep sends.
    // Plain text, multi-line. Each rep edits their own on /account; reps
    // never see or edit another rep's signature.
    emailSignature: text('email_signature'),
    // Optional inline logo image (data URI, PNG/JPG/WebP/GIF — no SVG).
    // Rendered in the HTML version of outgoing emails; the text-only version
    // still has the plain signature text. Capped ~500KB after base64.
    signatureLogoUrl: text('signature_logo_url'),
    // Optional URL to wrap the logo (and a "Visit" link at the bottom of
    // the signature). Validated server-side to be http(s) only.
    signatureLink: varchar('signature_link', { length: 500 }),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
    companyIdx: index('users_company_idx').on(t.companyId),
  })
);

export const permissions = pgTable(
  'permissions',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 100 }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.permissionKey] }) })
);

export const passwordResets = pgTable('password_resets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Short-lived email verification codes for sensitive actions (2-step verification).
 *
 * `purpose` distinguishes flows: 'password_change', 'email_change', etc.
 * `payloadHash` holds the hash of the pending change (e.g. the bcrypt of the NEW
 * password) so the actual secret is never stored in plaintext while waiting for
 * the code. `codeHash` is the SHA-256 of the 6-digit code we emailed.
 */
export const verificationCodes = pgTable(
  'verification_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 40 }).notNull(),
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    // Pending change payload (already hashed/encrypted as appropriate). Optional.
    payload: text('payload'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userPurposeIdx: index('verification_codes_user_purpose_idx').on(t.userId, t.purpose),
  })
);

/* ---------- Funders ---------- */

export const funderTiers = pgTable(
  'funder_tiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index('funder_tiers_company_idx').on(t.companyId) })
);

export const funders = pgTable(
  'funders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    submissionMethod: submissionMethodEnum('submission_method').notNull().default('email'),
    supportsReverseConsolidation: boolean('supports_reverse_consolidation').notNull().default(false),
    minRevenue: numeric('min_revenue', { precision: 14, scale: 2 }).notNull().default('0'),
    maxPositions: integer('max_positions').notNull().default(99),
    minCreditTier: creditTierEnum('min_credit_tier').notNull().default('unknown'),
    // Multiple funder-level emails / phones (in addition to named contacts).
    emails: jsonb('emails').$type<string[]>(),
    phones: jsonb('phones').$type<string[]>(),
    notes: text('notes'),
    // ASCII-only subject mode. When true, the email subject sent to this
    // funder skips the invisible thread-breaker characters. Some funder CRMs
    // can't decode Unicode in subjects and render zero-width chars as "?".
    // Default false; admin flips it on for the specific funders that have
    // legacy intake systems.
    plainSubjectOnly: boolean('plain_subject_only').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index('funders_company_idx').on(t.companyId) })
);

export const funderTierAssignments = pgTable(
  'funder_tier_assignments',
  {
    funderId: uuid('funder_id').notNull().references(() => funders.id, { onDelete: 'cascade' }),
    tierId: uuid('tier_id').notNull().references(() => funderTiers.id, { onDelete: 'cascade' }),
    // Per-tier overrides. NULL = inherit from funder's base value. Allows a
    // funder to appear in multiple tiers with different constraints, so
    // e.g. a 3-position deal can match the same funder via "Subprime" (max 4)
    // even when it's excluded from "A-Paper" (max 2) on the same funder.
    maxPositions: integer('max_positions'),
    minRevenue: numeric('min_revenue', { precision: 14, scale: 2 }),
    minCreditTier: varchar('min_credit_tier', { length: 32 }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.funderId, t.tierId] }) })
);

export const funderContacts = pgTable(
  'funder_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    funderId: uuid('funder_id').notNull().references(() => funders.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    // Optional role label: 'iso_rep' | 'underwriter' | 'funding_manager' | 'other'
    role: varchar('role', { length: 40 }),
    phone: varchar('phone', { length: 50 }),
    email: varchar('email', { length: 255 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({ funderIdx: index('funder_contacts_funder_idx').on(t.funderId) })
);

export const funderRestrictedStates = pgTable(
  'funder_restricted_states',
  {
    funderId: uuid('funder_id').notNull().references(() => funders.id, { onDelete: 'cascade' }),
    stateCode: varchar('state_code', { length: 2 }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.funderId, t.stateCode] }) })
);

export const funderRestrictedIndustries = pgTable(
  'funder_restricted_industries',
  {
    funderId: uuid('funder_id').notNull().references(() => funders.id, { onDelete: 'cascade' }),
    industry: varchar('industry', { length: 100 }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.funderId, t.industry] }) })
);

/* ---------- Master defaults (cloned into new companies) ---------- */

export const masterDefaultFunders = pgTable('master_default_funders', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  submissionMethod: submissionMethodEnum('submission_method').notNull().default('email'),
  supportsReverseConsolidation: boolean('supports_reverse_consolidation').notNull().default(false),
  minRevenue: numeric('min_revenue', { precision: 14, scale: 2 }).notNull().default('0'),
  maxPositions: integer('max_positions').notNull().default(99),
  minCreditTier: creditTierEnum('min_credit_tier').notNull().default('unknown'),
  notes: text('notes'),
  // Stored as { tiers: string[], contacts: [{name,phone,email,isPrimary}], restrictedStates: string[], restrictedIndustries: string[] }
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Deals ---------- */

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    merchantFirstName: varchar('merchant_first_name', { length: 100 }),
    merchantLastName: varchar('merchant_last_name', { length: 100 }),
    merchantEmail: varchar('merchant_email', { length: 255 }),
    merchantPhone: varchar('merchant_phone', { length: 50 }),
    offerNotes: text('offer_notes'),
    // Structured numeric offer amount (separate from free-text offerNotes).
    // Nullable so legacy rows continue to work.
    offerAmount: numeric('offer_amount', { precision: 14, scale: 2 }),
    assignedRepId: uuid('assigned_rep_id').references(() => users.id, { onDelete: 'set null' }),
    status: dealStatusEnum('status').notNull().default('shopping'),
    // ---- Funding / paydown fields (additive, nullable so legacy rows work) ----
    fundedAmount: numeric('funded_amount', { precision: 14, scale: 2 }),
    netAmount: numeric('net_amount', { precision: 14, scale: 2 }),
    feePct: numeric('fee_pct', { precision: 6, scale: 3 }),
    factorRate: numeric('factor_rate', { precision: 6, scale: 4 }),
    termMode: varchar('term_mode', { length: 10 }),         // 'daily' | 'weekly'
    termCount: numeric('term_count', { precision: 8, scale: 2 }), // # of days or weeks
    fundingDate: timestamp('funding_date', { withTimezone: true }),
    // Total collected so far (drives the paydown tracker). Defaults handled in app.
    amountCollected: numeric('amount_collected', { precision: 14, scale: 2 }),
    renewalNotes: text('renewal_notes'),
    // Funded-deal sub-status — only meaningful when status='funded'. Lets the
    // user mark a funded deal as 'active' (paying normally), 'refi_eligible'
    // (ready to renew), 'payment_issues' (struggling), or 'default' (stopped
    // paying). On the Funded Deals page this replaces the broad "Funded"
    // status badge with the more useful sub-state. Default 'active' so
    // legacy funded deals don't need a migration. Additive — null treated
    // as 'active' in the UI.
    fundedSubStatus: varchar('funded_sub_status', { length: 24 }),
    // Soft-delete flag. When true, the deal is treated as gone everywhere —
    // hidden from dropdowns, lists, commission views, accounting, etc. We
    // soft-delete instead of hard-delete so historical audit data is
    // preserved and bookkeeping records aren't orphaned by cascade.
    isDeleted: boolean('is_deleted').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('deals_company_idx').on(t.companyId),
    companyCreatedIdx: index('deals_company_created_idx').on(t.companyId, t.createdAt),
  })
);

/* ---------- Submissions ----------
   ONE submission row per deal, ever. Re-shopping adds new submission_funders rows. */

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id').notNull().unique().references(() => deals.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index('submissions_company_idx').on(t.companyId) })
);

/**
 * Multi-offer tracking per deal. One deal can collect many offers from
 * different funders / iterations; the rep can mark one as "accepted" which
 * makes it the canonical offer for funding-detail display elsewhere.
 *
 * Backward-compatible with the legacy single-offer columns on `deals`
 * (offerAmount, offerNotes) — those stay; new code prefers this table when
 * any rows exist, and falls back to the legacy columns otherwise.
 */
export const dealOffers = pgTable(
  'deal_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
    // All money/numeric fields nullable so partial offers can be saved as
    // they come in (some funders send factor + term first, then payment).
    fundingAmount: numeric('funding_amount', { precision: 14, scale: 2 }),
    factorRate: numeric('factor_rate', { precision: 6, scale: 4 }),
    // Term — independent count + mode so a 90-day daily deal vs 12-week deal
    // both store cleanly. termMode: 'days' | 'weeks' | 'months'.
    termCount: integer('term_count'),
    termMode: varchar('term_mode', { length: 16 }),
    fees: numeric('fees', { precision: 14, scale: 2 }),
    paymentAmount: numeric('payment_amount', { precision: 14, scale: 2 }),
    // Free-text per-offer notes (e.g. "Yellowstone, $5k commission, 2nd position OK")
    notes: text('notes'),
    // Which funder sent this offer (optional — may be entered before tagging)
    funderId: uuid('funder_id').references(() => funders.id, { onDelete: 'set null' }),
    // The rep can mark one offer as accepted. The deal's legacy offer fields
    // get auto-updated from this row so existing dashboards keep working.
    isAccepted: boolean('is_accepted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dealIdx: index('deal_offers_deal_idx').on(t.dealId),
  })
);

export const submissionFunders = pgTable(
  'submission_funders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
    // Nullable when a manual funder name is entered (not in directory)
    funderId: uuid('funder_id').references(() => funders.id, { onDelete: 'set null' }),
    manualFunderName: varchar('manual_funder_name', { length: 200 }),
    status: submissionFunderStatusEnum('status').notNull().default('no_response'),
    notes: text('notes'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({ submissionIdx: index('submission_funders_submission_idx').on(t.submissionId) })
);

export const submissionEmails = pgTable(
  'submission_emails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionFunderId: uuid('submission_funder_id')
      .notNull()
      .references(() => submissionFunders.id, { onDelete: 'cascade' }),
    toEmail: varchar('to_email', { length: 255 }).notNull(),
    ccEmails: jsonb('cc_emails').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    subject: varchar('subject', { length: 500 }).notNull(),
    body: text('body').notNull(),
    // Just metadata, not the bytes — { name, size }[]
    attachmentMeta: jsonb('attachment_meta').$type<{ name: string; size: number }[]>().notNull().default(sql`'[]'::jsonb`),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    smtpMessageId: varchar('smtp_message_id', { length: 500 }),
    smtpResponse: text('smtp_response'),
    success: boolean('success').notNull().default(true),
    errorMessage: text('error_message'),
  },
  (t) => ({ sfIdx: index('submission_emails_sf_idx').on(t.submissionFunderId) })
);

/* ---------- Funded Board ---------- */

export const fundedEntries = pgTable(
  'funded_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    repId: uuid('rep_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    dealInitials: varchar('deal_initials', { length: 50 }).notNull(),
    amountFunded: numeric('amount_funded', { precision: 14, scale: 2 }).notNull(),
    // Free-text name of the funder that funded the deal — NOT tied to the funder
    // directory on purpose, so reps can type anything. Nullable for legacy rows.
    fundedWith: varchar('funded_with', { length: 200 }),
    fundedDate: timestamp('funded_date', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('funded_entries_company_idx').on(t.companyId),
    companyDateIdx: index('funded_entries_company_date_idx').on(t.companyId, t.fundedDate),
  })
);

/* ---------- Knowledge Base ---------- */

export const infoEntries = pgTable(
  'info_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }).notNull(),
    body: text('body').notNull(),
    category: varchar('category', { length: 100 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index('info_entries_company_idx').on(t.companyId) })
);

/* ---------- Settings: Commission rules & structured email fields ---------- */

export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    // Inclusive ceiling: factor rate <= threshold gets this commission
    threshold: numeric('threshold', { precision: 6, scale: 4 }).notNull(),
    commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({ companyIdx: index('commission_rules_company_idx').on(t.companyId) })
);

export const structuredEmailFields = pgTable(
  'structured_email_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    fieldLabel: varchar('field_label', { length: 100 }).notNull(),
    fieldKey: varchar('field_key', { length: 100 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({ companyIdx: index('structured_email_fields_company_idx').on(t.companyId) })
);

/**
 * Editable matching options — credit ranges, revenue ranges, industries, deal types, etc.
 * Per-company. Replaces hardcoded dropdowns.
 *
 * `kind` values:
 *   'credit_range'   — { value: 'above_700', label: 'Above 700', minScore?: 700 }
 *   'revenue_range'  — { value: '0-25000', label: 'Below $25K', minRevenue: 0, maxRevenue: 25000 }
 *   'industry'       — { value: 'restaurant', label: 'Restaurant' }
 *   'deal_type'      — { value: 'standard_mca', label: 'Standard MCA' }
 *   'position_option'— { value: '0', label: 'Position 0 (no stack)' }
 *   'nsf_option'     — { value: '0', label: '0 NSFs' }
 *
 * `meta` is a flexible JSON object for additional config per option (e.g. minScore on credit ranges).
 */
export const matchOptions = pgTable(
  'match_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 30 }).notNull(),
    value: varchar('value', { length: 100 }).notNull(),
    label: varchar('label', { length: 200 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
  },
  (t) => ({
    companyKindIdx: index('match_options_company_kind_idx').on(t.companyId, t.kind),
    uniq: uniqueIndex('match_options_company_kind_value_idx').on(t.companyId, t.kind, t.value),
  })
);

/* ---------- Commissions (Slice B) ---------- */

// Commission lifecycle. Auto: pending for 30 days post-funding, then cleared.
// Admin can manually set any of these.
export const commissionStatusEnum = pgEnum('commission_status', [
  'pending',
  'cleared',
  'clawed_back',
]);

// Sync state for the external Google Sheet mirror (used in the next slice).
export const syncStateEnum = pgEnum('sync_state', ['pending', 'synced', 'failed']);

/**
 * Per-user saved contact list for funded emails. When a rep clicks "Send
 * funded email" they can either type any address OR pick from this list.
 *
 * Scoped to (companyId, userId) so each rep manages their own list — never
 * shared between reps. Admins don't get a global override either; this is
 * personal, not company-wide.
 */
export const fundedEmailContacts = pgTable(
  'funded_email_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    company: varchar('company', { length: 200 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

/**
 * Lead sources — external partners who refer deals and get paid a commission.
 * Optionally linked to a login user (role 'lead_source') for the restricted portal.
 */
export const leadSources = pgTable(
  'lead_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    contactEmail: varchar('contact_email', { length: 255 }),
    contactPhone: varchar('contact_phone', { length: 50 }),
    // Optional portal login. When set, that user sees ONLY their own payout summary.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index('lead_sources_company_idx').on(t.companyId) })
);

/**
 * Rep commission for a funded deal. One per deal (unique dealId).
 * The deal stays the source of truth; this holds the money math.
 */
export const dealCommissions = pgTable(
  'deal_commissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
    repId: uuid('rep_id').references(() => users.id, { onDelete: 'set null' }),

    // Deal financials (entered by admin; mirror of the funded structure)
    fundedAmount: numeric('funded_amount', { precision: 14, scale: 2 }),
    rate: numeric('rate', { precision: 6, scale: 4 }),           // e.g. 1.4900
    termMonths: numeric('term_months', { precision: 6, scale: 2 }),
    // Term structure: 'daily' or 'weekly', plus the count of days/weeks.
    // Nullable so legacy rows keep working (they only had termMonths).
    termMode: varchar('term_mode', { length: 10 }),
    termCount: numeric('term_count', { precision: 8, scale: 2 }),
    fees: numeric('fees', { precision: 14, scale: 2 }),
    brokerFee: numeric('broker_fee', { precision: 14, scale: 2 }),

    // Commission math
    grossCommission: numeric('gross_commission', { precision: 14, scale: 2 }).notNull().default('0'),
    repSplitPct: numeric('rep_split_pct', { precision: 6, scale: 3 }).notNull().default('0'), // e.g. 30.000
    // Computed + stored for convenience (admin can override)
    repCommissionAmount: numeric('rep_commission_amount', { precision: 14, scale: 2 }).notNull().default('0'),

    paidAmount: numeric('paid_amount', { precision: 14, scale: 2 }).notNull().default('0'),

    status: commissionStatusEnum('status').notNull().default('pending'),
    fundingDate: timestamp('funding_date', { withTimezone: true }),
    clearedDate: timestamp('cleared_date', { withTimezone: true }),
    earlyPayoffDiscount: text('early_payoff_discount'),
    notes: text('notes'),

    // Soft-delete: never hard-delete so the Sheet backup stays meaningful
    isDeleted: boolean('is_deleted').notNull().default(false),

    // Sheet sync bookkeeping (used next slice)
    syncState: syncStateEnum('sync_state').notNull().default('pending'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    syncError: text('sync_error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('deal_commissions_company_idx').on(t.companyId),
    dealUniq: uniqueIndex('deal_commissions_deal_idx').on(t.dealId),
    repIdx: index('deal_commissions_rep_idx').on(t.repId),
  })
);

/**
 * Lead source commission for a deal. Separate from rep commissions.
 * Either a split % of gross OR a flat amount.
 */
export const leadSourceCommissions = pgTable(
  'lead_source_commissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
    leadSourceId: uuid('lead_source_id').notNull().references(() => leadSources.id, { onDelete: 'cascade' }),

    // Either splitPct (of gross commission) OR flatAmount is used.
    splitPct: numeric('split_pct', { precision: 6, scale: 3 }),
    flatAmount: numeric('flat_amount', { precision: 14, scale: 2 }),
    // Self-contained math inputs — NEVER read from or written to the parent
    // deal/rep commission. Entered when the LS commission is logged.
    grossCommission: numeric('ls_gross_commission', { precision: 14, scale: 2 }),
    brokerFee: numeric('ls_broker_fee', { precision: 14, scale: 2 }),
    fundingDate: timestamp('ls_funding_date', { withTimezone: true }),
    // Resolved commission owed (computed from whichever method, stored for convenience)
    commissionAmount: numeric('commission_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    paidAmount: numeric('paid_amount', { precision: 14, scale: 2 }).notNull().default('0'),

    status: commissionStatusEnum('status').notNull().default('pending'),
    earlyPayoffDiscount: text('early_payoff_discount'),
    notes: text('notes'),
    isDeleted: boolean('is_deleted').notNull().default(false),

    syncState: syncStateEnum('sync_state').notNull().default('pending'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    syncError: text('sync_error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('lead_source_commissions_company_idx').on(t.companyId),
    dealIdx: index('lead_source_commissions_deal_idx').on(t.dealId),
    leadSourceIdx: index('lead_source_commissions_ls_idx').on(t.leadSourceId),
  })
);

/**
 * Google Sheets sync configuration — one row per company.
 * Holds the encrypted service-account JSON + target Sheet ID. The Sheet is an
 * external live backup mirror; the CRM database stays the source of truth.
 */
/**
 * Logged commission payments — a payout actually sent to a rep (or recorded
 * against a specific deal commission). Builds the payment history.
 */
/**
 * Accounting ledger — admin records actual money in/out per deal. Separate
 * from commission tracking. Two types of entries:
 *   - 'received': money received from the funder for a funded deal
 *   - 'sent_back': money refunded/returned (clawback, refund)
 */
export const accountingEntries = pgTable(
  'accounting_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    entryType: varchar('entry_type', { length: 20 }).notNull(),  // received | sent_back
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    entryDate: timestamp('entry_date', { withTimezone: true }).notNull().defaultNow(),
    method: varchar('method', { length: 20 }),  // ach | wire | check | cash | zelle | other
    referenceNumber: varchar('reference_number', { length: 120 }),
    notes: text('notes'),
    isDeleted: boolean('is_deleted').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('accounting_entries_company_idx').on(t.companyId),
    dealIdx: index('accounting_entries_deal_idx').on(t.dealId),
  })
);

export const commissionPayments = pgTable(
  'commission_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    repId: uuid('rep_id').references(() => users.id, { onDelete: 'set null' }),
    // Optional link to a specific deal commission (null = general payout to rep).
    dealCommissionId: uuid('deal_commission_id').references(() => dealCommissions.id, { onDelete: 'set null' }),
    // Optional link to a lead source commission instead.
    leadSourceCommissionId: uuid('lead_source_commission_id').references(() => leadSourceCommissions.id, { onDelete: 'set null' }),
    // Optional link to the lead source itself (so the lead-source portal can show its history)
    leadSourceId: uuid('lead_source_id').references(() => leadSources.id, { onDelete: 'set null' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    paidDate: timestamp('paid_date', { withTimezone: true }).notNull().defaultNow(),
    method: varchar('method', { length: 20 }), // ach | wire | check | cash | zelle | other
    isDeleted: boolean('is_deleted').notNull().default(false),
    confirmationNumber: varchar('confirmation_number', { length: 120 }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('commission_payments_company_idx').on(t.companyId),
    repIdx: index('commission_payments_rep_idx').on(t.repId),
  })
);

/**
 * Commission draws / advances — money fronted to a rep, deducted from future
 * commission owed. Positive amount = draw taken.
 */
export const commissionDraws = pgTable(
  'commission_draws',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    repId: uuid('rep_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    drawDate: timestamp('draw_date', { withTimezone: true }).notNull().defaultNow(),
    // How much of this draw has been recouped from commissions so far.
    recoupedAmount: numeric('recouped_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index('commission_draws_company_idx').on(t.companyId),
    repIdx: index('commission_draws_rep_idx').on(t.repId),
  })
);

export const sheetSyncConfig = pgTable(
  'sheet_sync_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().unique().references(() => companies.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    // Service-account JSON, encrypted at rest (AES-256-GCM via lib/crypto).
    encryptedCredentials: text('encrypted_credentials'),
    // The service account email (safe to store plain; shown in UI so admin knows
    // which address to share the Sheet with).
    serviceAccountEmail: varchar('service_account_email', { length: 320 }),
    spreadsheetId: varchar('spreadsheet_id', { length: 120 }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncStatus: varchar('last_sync_status', { length: 20 }), // 'ok' | 'error'
    lastSyncError: text('last_sync_error'),
    // Per-table cursors for append-only backup. Shape: { [tableName]: ISO timestamp }.
    // On each sync, we append every row that was updated AFTER its table's cursor.
    // Deleted/edited rows are NEVER removed from the sheet — the sheet is a permanent log.
    backupCursors: jsonb('backup_cursors'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

/* ---------- Relations ---------- */

export const companiesRelations = relations(companies, ({ many }) => ({
  users: many(users),
  funders: many(funders),
  funderTiers: many(funderTiers),
  deals: many(deals),
  submissions: many(submissions),
  fundedEntries: many(fundedEntries),
  infoEntries: many(infoEntries),
  commissionRules: many(commissionRules),
  structuredEmailFields: many(structuredEmailFields),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
  permissions: many(permissions),
  fundedEntries: many(fundedEntries),
}));

export const permissionsRelations = relations(permissions, ({ one }) => ({
  user: one(users, { fields: [permissions.userId], references: [users.id] }),
}));

export const fundersRelations = relations(funders, ({ one, many }) => ({
  company: one(companies, { fields: [funders.companyId], references: [companies.id] }),
  tierAssignments: many(funderTierAssignments),
  contacts: many(funderContacts),
  restrictedStates: many(funderRestrictedStates),
  restrictedIndustries: many(funderRestrictedIndustries),
}));

export const funderTiersRelations = relations(funderTiers, ({ one, many }) => ({
  company: one(companies, { fields: [funderTiers.companyId], references: [companies.id] }),
  assignments: many(funderTierAssignments),
}));

export const funderTierAssignmentsRelations = relations(funderTierAssignments, ({ one }) => ({
  funder: one(funders, { fields: [funderTierAssignments.funderId], references: [funders.id] }),
  tier: one(funderTiers, { fields: [funderTierAssignments.tierId], references: [funderTiers.id] }),
}));

export const funderContactsRelations = relations(funderContacts, ({ one }) => ({
  funder: one(funders, { fields: [funderContacts.funderId], references: [funders.id] }),
}));

export const funderRestrictedStatesRelations = relations(funderRestrictedStates, ({ one }) => ({
  funder: one(funders, { fields: [funderRestrictedStates.funderId], references: [funders.id] }),
}));

export const funderRestrictedIndustriesRelations = relations(funderRestrictedIndustries, ({ one }) => ({
  funder: one(funders, { fields: [funderRestrictedIndustries.funderId], references: [funders.id] }),
}));

export const dealsRelations = relations(deals, ({ one }) => ({
  company: one(companies, { fields: [deals.companyId], references: [companies.id] }),
  assignedRep: one(users, { fields: [deals.assignedRepId], references: [users.id] }),
  creator: one(users, { fields: [deals.createdBy], references: [users.id] }),
  submission: one(submissions, { fields: [deals.id], references: [submissions.dealId] }),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  deal: one(deals, { fields: [submissions.dealId], references: [deals.id] }),
  company: one(companies, { fields: [submissions.companyId], references: [companies.id] }),
  funders: many(submissionFunders),
}));

export const submissionFundersRelations = relations(submissionFunders, ({ one, many }) => ({
  submission: one(submissions, { fields: [submissionFunders.submissionId], references: [submissions.id] }),
  funder: one(funders, { fields: [submissionFunders.funderId], references: [funders.id] }),
  emails: many(submissionEmails),
}));

export const submissionEmailsRelations = relations(submissionEmails, ({ one }) => ({
  submissionFunder: one(submissionFunders, {
    fields: [submissionEmails.submissionFunderId],
    references: [submissionFunders.id],
  }),
}));

export const fundedEntriesRelations = relations(fundedEntries, ({ one }) => ({
  company: one(companies, { fields: [fundedEntries.companyId], references: [companies.id] }),
  rep: one(users, { fields: [fundedEntries.repId], references: [users.id] }),
}));

export const infoEntriesRelations = relations(infoEntries, ({ one }) => ({
  company: one(companies, { fields: [infoEntries.companyId], references: [companies.id] }),
  creator: one(users, { fields: [infoEntries.createdBy], references: [users.id] }),
}));

export const commissionRulesRelations = relations(commissionRules, ({ one }) => ({
  company: one(companies, { fields: [commissionRules.companyId], references: [companies.id] }),
}));

export const structuredEmailFieldsRelations = relations(structuredEmailFields, ({ one }) => ({
  company: one(companies, { fields: [structuredEmailFields.companyId], references: [companies.id] }),
}));

/* ---------- Permission keys (constants) ---------- */

export const PERMISSION_KEYS = {
  DEALS_VIEW: 'deals.view',
  DEALS_SHOP: 'deals.shop',
  DEALS_SUBMIT: 'deals.submit',
  DEALS_EDIT: 'deals.edit',
  FUNDERS_VIEW: 'funders.view',
  FUNDERS_EDIT: 'funders.edit',
  SUBMISSIONS_VIEW: 'submissions.view',
  SUBMISSIONS_EDIT: 'submissions.edit',
  ACTIVE_DEALS_VIEW: 'active_deals.view',
  ACTIVE_DEALS_EDIT: 'active_deals.edit',
  FUNDED_BOARD_VIEW: 'funded_board.view',
  FUNDED_BOARD_EDIT: 'funded_board.edit',
  CALCULATOR_USE: 'calculator.use',
  INFO_VIEW: 'info.view',
  INFO_EDIT: 'info.edit',
  SETTINGS_MANAGE: 'settings.manage',
  USERS_MANAGE: 'users.manage',
  COMMISSIONS_VIEW: 'commissions.view',       // rep: see own commissions
  COMMISSIONS_MANAGE: 'commissions.manage',   // admin: edit all commissions + lead sources
} as const;

export const ALL_REP_PERMISSIONS = [
  PERMISSION_KEYS.DEALS_VIEW,
  PERMISSION_KEYS.DEALS_SHOP,
  PERMISSION_KEYS.DEALS_SUBMIT,
  PERMISSION_KEYS.FUNDERS_VIEW,
  PERMISSION_KEYS.SUBMISSIONS_VIEW,
  PERMISSION_KEYS.SUBMISSIONS_EDIT,
  PERMISSION_KEYS.ACTIVE_DEALS_VIEW,
  PERMISSION_KEYS.ACTIVE_DEALS_EDIT,
  PERMISSION_KEYS.FUNDED_BOARD_VIEW,
  PERMISSION_KEYS.CALCULATOR_USE,
  PERMISSION_KEYS.INFO_VIEW,
  PERMISSION_KEYS.COMMISSIONS_VIEW,
];

export type CompanyRow = typeof companies.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type FunderRow = typeof funders.$inferSelect;
export type DealRow = typeof deals.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;
export type SubmissionFunderRow = typeof submissionFunders.$inferSelect;
export type LeadSourceRow = typeof leadSources.$inferSelect;
export type DealCommissionRow = typeof dealCommissions.$inferSelect;
export type LeadSourceCommissionRow = typeof leadSourceCommissions.$inferSelect;
export type SheetSyncConfigRow = typeof sheetSyncConfig.$inferSelect;
export type CommissionPaymentRow = typeof commissionPayments.$inferSelect;
export type AccountingEntryRow = typeof accountingEntries.$inferSelect;
export type CommissionDrawRow = typeof commissionDraws.$inferSelect;
