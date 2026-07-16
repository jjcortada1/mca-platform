import { z } from 'zod';

/* ---------- Auth ---------- */

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export const passwordRequirements = z.string().min(8, 'Password must be at least 8 characters');

export const forgotPasswordSchema = z.object({ email: z.string().email().toLowerCase().trim() });

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: passwordRequirements,
});

/* ---------- Companies ---------- */

export const createCompanySchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
  adminEmail: z.string().email().toLowerCase().trim(),
  adminName: z.string().min(2).max(200),
  adminPassword: passwordRequirements,
  // How to seed the new company's funder directory:
  //   'master' — clone the master default funders (legacy default)
  //   'copy'   — clone another company's live funder list (copyFromCompanyId required)
  //   'none'   — start empty; the company uploads/enters their own funders
  funderSeedMode: z.enum(['master', 'copy', 'none']).default('master'),
  copyFromCompanyId: z.string().uuid().optional().nullable(),
});

/* ---------- Users ---------- */

export const createUserSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  name: z.string().min(2).max(200),
  role: z.enum(['company_admin', 'rep', 'lead_source']),
  password: passwordRequirements,
  permissions: z.array(z.string()).default([]),
  leadSourceId: z.string().uuid().optional().nullable(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  email: z.string().email().toLowerCase().trim().optional(),
  role: z.enum(['company_admin', 'rep', 'lead_source']).optional(),
  password: z.string().min(8).optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
  leadSourceId: z.string().uuid().optional().nullable(),
});

/* ---------- Funders ---------- */

const creditTier = z.enum(['unknown', 'under_550', '550_599', '600_649', '650_plus']);

export const upsertFunderSchema = z.object({
  name: z.string().min(1).max(200),
  submissionMethod: z.enum(['email', 'portal']).default('email'),
  supportsReverseConsolidation: z.boolean().default(false),
  minRevenue: z.coerce.number().nonnegative().default(0),
  maxPositions: z.coerce.number().int().nonnegative().default(99),
  minCreditTier: creditTier.default('unknown'),
  notes: z.string().max(5000).optional().nullable(),
  isActive: z.boolean().default(true),
  // Legacy-CRM compatibility flag: when true, subject sent to this funder
  // is plain ASCII (no zero-width thread-breaker).
  plainSubjectOnly: z.boolean().default(false).optional(),
  // funders.emails — submission emails used when shopping a deal. Multiple OK.
  emails: z.array(z.string().email()).default([]).optional(),
  // Legacy: array of tier UUIDs (no overrides). Still accepted.
  tierIds: z.array(z.string().uuid()).default([]),
  // Preferred: array of tier assignments with per-tier override fields.
  // Each null override = inherit from base funder value.
  tierAssignments: z
    .array(
      z.object({
        tierId: z.string().uuid(),
        maxPositions: z.coerce.number().int().nonnegative().nullable().optional(),
        minRevenue: z.coerce.number().nonnegative().nullable().optional(),
        minCreditTier: creditTier.nullable().optional(),
      })
    )
    .optional(),
  contacts: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        phone: z.string().max(50).optional().nullable(),
        email: z.string().email().optional().nullable().or(z.literal('')),
        isPrimary: z.boolean().default(false),
      })
    )
    .default([]),
  restrictedStates: z.array(z.string().length(2)).default([]),
  restrictedIndustries: z.array(z.string().max(100)).default([]),
});

export const createTierSchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().default(0),
});

/* ---------- Deal Shop ---------- */

export const dealShopMatchSchema = z.object({
  // Nullable so matching can start from the FIRST criterion entered —
  // fields the user hasn't filled yet are sent as null and skipped by the
  // engine (never treated as $0 revenue / 0 positions).
  monthlyRevenue: z.number().nonnegative().nullable().optional(),
  // Either legacy enum (back-compat) or new numeric floor from match_options.meta.minScore
  creditScore: creditTier.optional(),
  creditScoreValue: z.number().nullable().optional(),
  positions: z.number().int().nonnegative().nullable().optional(),
  industry: z.string().max(100).default('other'),
  // 'other' (or any 2-letter code) — 'other' means skip state filtering
  state: z.string().max(10).default('other'),
  dealType: z.enum(['standard_mca', 'reverse_consolidation']),
});

/* ---------- Deals ---------- */

export const upsertDealSchema = z.object({
  name: z.string().min(1).max(200),
  merchantFirstName: z.string().max(100).optional().nullable(),
  merchantLastName: z.string().max(100).optional().nullable(),
  merchantEmail: z.string().email().optional().nullable().or(z.literal('')),
  merchantPhone: z.string().max(50).optional().nullable(),
  offerNotes: z.string().max(10000).optional().nullable(),
  assignedRepId: z.string().uuid().optional().nullable(),
  dealType: z.enum(['standard_mca', 'reverse_consolidation']).optional(),
  status: z.enum([
    'shopping', 'submitted', 'active', 'not_active', 'offer', 'funded', 'dead', 'declined',
    'waiting_on_offer',
    'payment_issues', 'eligible_for_renewal', 'default', 'paid_off', 'closed',
    'pending_funding', 'renewal_sent', 'in_collections', 'on_hold',
  ]).optional(),
  offerAmount: z.coerce.number().nonnegative().optional().nullable(),
  // Paydown / funding fields
  fundedAmount: z.coerce.number().nonnegative().optional().nullable(),
  netAmount: z.coerce.number().nonnegative().optional().nullable(),
  feePct: z.coerce.number().min(0).max(100).optional().nullable(),
  factorRate: z.coerce.number().nonnegative().optional().nullable(),
  termMode: z.enum(['daily', 'weekly']).optional().nullable(),
  termCount: z.coerce.number().nonnegative().optional().nullable(),
  fundingDate: z.string().optional().nullable(),
  amountCollected: z.coerce.number().nonnegative().optional().nullable(),
  renewalNotes: z.string().max(10000).optional().nullable(),
  // Funded-deal sub-status — only meaningful when status='funded'. The
  // Funded Deals page exposes this as a small select on each row.
  // 'refinanced' is NOT user-selectable from the dropdown — it's set
  // programmatically by the "Mark as refinanced" flow on the funded deal
  // editor. We accept it on PATCH so that flow can write it.
  fundedSubStatus: z.enum(['active', 'refi_eligible', 'payment_issues', 'default', 'refinanced']).optional().nullable(),
  // Funded-with funder linkage — admin sets it on the funded-deal editor;
  // reps can set it from their commission detail panel.
  fundedWithFunderId: z.string().uuid().optional().nullable().or(z.literal('')),
  fundedWithName: z.string().max(200).optional().nullable(),
  // Notes attached to the funded deal — separate from offerNotes (which
  // is pre-funding context) so the funded notes don't pollute the shop view.
  fundedNotes: z.string().max(10000).optional().nullable(),
  // Payment pause + temporary payment modification (funded deals). Pausing
  // stamps paymentsPausedAt server-side; resuming clears it.
  paymentsPaused: z.boolean().optional(),
  modifiedPaymentAmount: z.coerce.number().nonnegative().optional().nullable(),
  modifiedPaymentUntil: z.string().optional().nullable(),
  paymentModificationNote: z.string().max(1000).optional().nullable(),
  // Submission intake — JSON blob with the structured "what to send the
  // funder" context. Shape is enforced by the form UI on /deal-shop;
  // the API just round-trips it. z.any() is intentional: the shape may
  // grow with new sections (e.g. payments history) without needing a
  // migration. Pass null to clear; omit to leave unchanged.
  submissionIntake: z.any().optional().nullable(),
});

/* ---------- Submissions ---------- */

export const submissionFunderInputSchema = z.object({
  funderId: z.string().uuid().optional().nullable(),
  manualFunderName: z.string().max(200).optional().nullable(),
  toEmail: z.string().email(),
});

export const sendSubmissionSchema = z.object({
  dealId: z.string().uuid(),
  bodyNotes: z.string().max(10000).default(''),
  structuredFields: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  ccEmails: z.array(z.string().email()).default([]),
  funders: z.array(submissionFunderInputSchema).min(1),
  // attachments come via multipart, validated separately
});

export const updateSubmissionFunderSchema = z.object({
  status: z.enum(['no_response', 'approved', 'declined']).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

/* ---------- Funded Board ---------- */

export const fundedEntrySchema = z.object({
  repId: z.string().uuid(),
  dealInitials: z.string().min(1).max(50),
  amountFunded: z.coerce.number().positive(),
  fundedWith: z.string().max(200).optional().nullable(),
  // Accept either a date (YYYY-MM-DD) or a full ISO datetime
  fundedDate: z.string().min(1).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

/* ---------- Calculator ---------- */

export const mcaCalcSchema = z.object({
  fundingAmount: z.number().positive(),
  factorRate: z.number().min(1).max(2),
  termDays: z.number().int().positive(),
  paymentFrequency: z.enum(['daily', 'weekly']),
  feesPct: z.number().min(0).max(100).default(0),
});

export const reverseCalcSchema = z.object({
  deposit: z.number().positive(),
  factorRate: z.number().min(1).max(2),
  payment: z.number().positive(),
  paymentFrequency: z.enum(['daily', 'weekly']),
  feeMinPct: z.number().min(0).max(100).default(2),
  feeMaxPct: z.number().min(0).max(100).default(10),
});

/* ---------- Info ---------- */

export const infoEntrySchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  category: z.string().max(100).optional().nullable(),
});

/* ---------- Settings ---------- */

export const commissionRulesSchema = z.object({
  rules: z.array(
    z.object({
      threshold: z.number().min(1).max(2),
      commissionPct: z.number().min(0).max(100),
    })
  ),
});

export const structuredFieldsSchema = z.object({
  fields: z.array(
    z.object({
      fieldLabel: z.string().min(1).max(100),
      fieldKey: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/),
    })
  ),
});

export const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1),
  password: z.string().min(1),
  from: z.string().min(1),
  secure: z.boolean().optional(),
});

export const emailModeSchema = z.object({
  emailMode: z.enum(['shared', 'per_rep']),
  globalCcEmails: z.array(z.string().email()).default([]),
});

/**
 * Syndication input — used by POST /api/deals/[id]/syndications.
 * The route fills in dealId + companyId from the URL + session; the
 * client only sends the rep + amount + optional date/notes.
 */
export const dealSyndicationInputSchema = z.object({
  repId: z.string().uuid(),
  syndicatedAmount: z.coerce.number().positive(),
  syndicatedDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
