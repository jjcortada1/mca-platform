import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { courtSearches } from '@/lib/db/schema';
import { requireTenantContext } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { searchPartyName } from '@/lib/court/ny-webcivil';
import type { CourtCase } from '@/lib/court/ny-webcivil';
import { businessNameVariants, personNameVariants, matchScore, toConfidence } from '@/lib/court/names';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  businessName: z.string().trim().max(300).optional(),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  dealId: z.string().uuid().optional(),
  county: z.string().trim().max(60).optional(),
  /** Skip saving — used for a throwaway lookup. */
  save: z.boolean().optional(),
});

export interface ScoredCase extends CourtCase {
  score: number;
  confidence: 'strong' | 'partial' | 'weak';
}

/**
 * POST /api/court/search — search the NY courts by party name.
 *
 * Runs the name variants in sequence (never in parallel: this is a public
 * service and hammering it gets the server blocked), de-duplicates by
 * index number, and scores each hit against what was searched so a
 * coincidental substring match is visibly weaker than an exact one.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenantContext();

    // Court lookups are outbound requests to a third party — cap them hard.
    const limited = rateLimit(`court:${ctx.user.id}`, { max: 20, windowMs: 60_000 });
    if (!limited.allowed) {
      return NextResponse.json(
        { error: 'Too many court searches in a short time. Wait a minute and try again.' },
        { status: 429 },
      );
    }

    const body = bodySchema.parse(await req.json());
    const business = body.businessName?.trim() ?? '';
    const first = body.firstName?.trim() ?? '';
    const last = body.lastName?.trim() ?? '';

    if (!business && !last) {
      return NextResponse.json(
        { error: 'Enter a business name, or a person’s last name (first name alone is not searchable).' },
        { status: 400 },
      );
    }

    const searchType = business ? 'business' : 'person';
    const variants = business ? businessNameVariants(business) : personNameVariants(first, last);

    const seen = new Set<string>();
    const cases: ScoredCase[] = [];
    let status: string = 'no_results';
    let error: string | undefined;
    let diagnostics: unknown = null;

    for (const variant of variants) {
      const res = await searchPartyName(variant, { county: body.county });
      diagnostics = res.diagnostics;

      if (res.status === 'blocked' || res.status === 'unavailable' || res.status === 'parse_failed') {
        // A failure on the first variant is the whole search failing; stop
        // rather than hammering a service that just refused us.
        status = res.status;
        error = res.error;
        break;
      }
      if (res.cases.length) status = 'ok';

      for (const c of res.cases) {
        const key = `${c.indexNumber}|${c.caption}`.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const score = matchScore(c.caption || c.matchedName, variant);
        cases.push({ ...c, score, confidence: toConfidence(score) });
      }
    }

    cases.sort((a, b) => b.score - a.score);

    let savedId: string | null = null;
    if (body.save !== false) {
      const [row] = await db.insert(courtSearches).values({
        companyId: ctx.companyId,
        dealId: body.dealId ?? null,
        searchType,
        businessName: business || null,
        firstName: first || null,
        lastName: last || null,
        provider: 'ny_webcivil',
        status,
        error: error ?? null,
        resultCount: cases.length,
        results: cases,
        diagnostics: diagnostics as never,
        createdBy: ctx.user.id,
      }).returning({ id: courtSearches.id });
      savedId = row?.id ?? null;
    }

    return NextResponse.json({
      data: {
        id: savedId,
        status,
        error: error ?? null,
        searched: variants,
        resultCount: cases.length,
        results: cases,
        diagnostics,
      },
    });
  } catch (e) { return apiError(e); }
}
