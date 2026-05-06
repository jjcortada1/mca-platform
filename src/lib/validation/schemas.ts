import { z } from 'zod';

/* ---------- Auth ---------- */

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export const passwordRequirements = z.string().min(10, 'Password must be at least 10 characters');

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
});

/* ---------- Users ---------- */

export const createUserSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  name: z.string().min(2).max(200),
  role: z.enum(['company_admin', 'rep']),
  password: passwordRequirements,
  permissions: z.array(z.string()).default([]),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  isActive: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
});

/* ---------- Funders ---------- */

const creditTier = z.enum(['unknown', 'under_550', '550_599', '600_649', '650_plus']);

export const upsertFunderSchema = z.object({
  name: z.string().min(1).max(200),
  submissionMethod: z.enum(['email', 'portal']).default('email'),
  supportsReverseConsolidation: z.boolean().default(false),
  minRevenue: z.number().nonnegative().default(0),
  maxPositions: z.number().int().nonnegative().default(99),
  minCreditTier: creditTier.default('unknown'),
  notes: z.string().max(5000).optional().nullable(),
  isActive: z.boolean().default(true),
  tierIds: z.array(z.string().uuid()).default([]),
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
  monthlyRevenue: z.number().nonnegative(),
  // Either legacy enum (back-compat) or new numeric floor from match_options.meta.minScore
  creditScore: creditTier.optional(),
  creditScoreValue: z.number().nullable().optional(),
  positions: z.number().int().nonnegative(),
  industry: z.string().max(100).default('other'),
  state: z.string().max(2).default('other'),
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
  status: z.enum(['shopping', 'submitted', 'active', 'funded', 'dead']).optional(),
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
  amountFunded: z.number().positive(),
  fundedDate: z.string().datetime().optional(),
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
