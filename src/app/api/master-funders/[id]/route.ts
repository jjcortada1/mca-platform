import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import { masterDefaultFunders } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireMasterAdmin } from '@/lib/auth/context';
import { handle, ok, noContent, notFound } from '@/lib/api/response';

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  submissionMethod: z.enum(['email', 'portal']).optional(),
  supportsReverseConsolidation: z.boolean().optional(),
  minRevenue: z.number().nonnegative().optional(),
  maxPositions: z.number().int().nonnegative().optional(),
  minCreditTier: z.enum(['unknown', 'under_550', '550_599', '600_649', '650_plus']).optional(),
  notes: z.string().max(5000).optional().nullable(),
  tiers: z.array(z.string().max(100)).optional(),
  contacts: z.array(z.object({
    name: z.string().min(1).max(200),
    phone: z.string().max(50).optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    isPrimary: z.boolean().default(false),
  })).optional(),
  restrictedStates: z.array(z.string().length(2)).optional(),
  restrictedIndustries: z.array(z.string().max(100)).optional(),
});

export const PATCH = handle(async (req: NextRequest, { params }: { params: { id: string } }) => {
  await requireMasterAdmin();
  const data = patchSchema.parse(await req.json());

  const [existing] = await db.select().from(masterDefaultFunders).where(eq(masterDefaultFunders.id, params.id));
  if (!existing) return notFound('Master funder not found');

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.submissionMethod !== undefined) updates.submissionMethod = data.submissionMethod;
  if (data.supportsReverseConsolidation !== undefined) updates.supportsReverseConsolidation = data.supportsReverseConsolidation;
  if (data.minRevenue !== undefined) updates.minRevenue = String(data.minRevenue);
  if (data.maxPositions !== undefined) updates.maxPositions = data.maxPositions;
  if (data.minCreditTier !== undefined) updates.minCreditTier = data.minCreditTier;
  if (data.notes !== undefined) updates.notes = data.notes;

  // Merge payload pieces
  const currentPayload = (existing.payload ?? {}) as Record<string, unknown>;
  const newPayload = { ...currentPayload };
  if (data.tiers !== undefined) newPayload.tiers = data.tiers;
  if (data.contacts !== undefined) newPayload.contacts = data.contacts;
  if (data.restrictedStates !== undefined) newPayload.restrictedStates = data.restrictedStates;
  if (data.restrictedIndustries !== undefined) newPayload.restrictedIndustries = data.restrictedIndustries;
  updates.payload = newPayload;

  await db.update(masterDefaultFunders).set(updates).where(eq(masterDefaultFunders.id, params.id));
  return ok({ id: params.id });
});

export const DELETE = handle(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  await requireMasterAdmin();
  await db.delete(masterDefaultFunders).where(eq(masterDefaultFunders.id, params.id));
  return noContent();
});
