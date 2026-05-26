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

export const userRoleEnum = pgEnum('user_role', ['master_admin', 'company_admin', 'rep']);
export const submissionMethodEnum = pgEnum('submission_method', ['email', 'portal']);
export const dealTypeEnum = pgEnum('deal_type', ['standard_mca', 'reverse_consolidation']);
export const dealStatusEnum = pgEnum('deal_status', ['shopping', 'submitted', 'active', 'funded', 'dead']);
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
    notes: text('notes'),
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
  },
  (t) => ({ pk: primaryKey({ columns: [t.funderId, t.tierId] }) })
);

export const funderContacts = pgTable(
  'funder_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    funderId: uuid('funder_id').notNull().references(() => funders.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
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
    assignedRepId: uuid('assigned_rep_id').references(() => users.id, { onDelete: 'set null' }),
    status: dealStatusEnum('status').notNull().default('shopping'),
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
];

export type CompanyRow = typeof companies.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type FunderRow = typeof funders.$inferSelect;
export type DealRow = typeof deals.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;
export type SubmissionFunderRow = typeof submissionFunders.$inferSelect;
