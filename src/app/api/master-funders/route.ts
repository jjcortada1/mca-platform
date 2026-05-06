import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { masterDefaultFunders } from '@/lib/db/schema';
import { z } from 'zod';
import { requireMasterAdmin } from '@/lib/auth/context';
import { handle, ok, created } from '@/lib/api/response';

const masterFunderSchema = z.object({
  name: z.string().min(1).max(200),
  submissionMethod: z.enum(['email', 'portal']).default('email'),
  supportsReverseConsolidation: z.boolean().default(false),
  minRevenue: z.number().nonnegative().default(0),
  maxPositions: z.number().int().nonnegative().default(99),
  minCreditTier: z.enum(['unknown', 'under_550', '550_599', '600_649', '650_plus']).default('unknown'),
  notes: z.string().max(5000).optional().nullable(),
  tiers: z.array(z.string().max(100)).default([]),
  contacts: z.array(z.object({
    name: z.string().min(1).max(200),
    phone: z.string().max(50).optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    isPrimary: z.boolean().default(false),
  })).default([]),
  restrictedStates: z.array(z.string().length(2)).default([]),
  restrictedIndustries: z.array(z.string().max(100)).default([]),
});

export const GET = handle(async () => {
  await requireMasterAdmin();
  const list = await db.select().from(masterDefaultFunders).orderBy(masterDefaultFunders.name);
  return ok(list.map((f) => ({
    id: f.id,
    name: f.name,
    submissionMethod: f.submissionMethod,
    supportsReverseConsolidation: f.supportsReverseConsolidation,
    minRevenue: parseFloat(String(f.minRevenue)),
    maxPositions: f.maxPositions,
    minCreditTier: f.minCreditTier,
    notes: f.notes,
    payload: f.payload,
  })));
});

export const POST = handle(async (req: NextRequest) => {
  await requireMasterAdmin();
  const data = masterFunderSchema.parse(await req.json());
  const [row] = await db.insert(masterDefaultFunders).values({
    name: data.name,
    submissionMethod: data.submissionMethod,
    supportsReverseConsolidation: data.supportsReverseConsolidation,
    minRevenue: String(data.minRevenue),
    maxPositions: data.maxPositions,
    minCreditTier: data.minCreditTier,
    notes: data.notes ?? null,
    payload: {
      tiers: data.tiers,
      contacts: data.contacts,
      restrictedStates: data.restrictedStates,
      restrictedIndustries: data.restrictedIndustries,
    },
  }).returning();
  return created({ id: row.id });
});
