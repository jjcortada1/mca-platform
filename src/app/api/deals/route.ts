import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { deals, users, dealOffers } from '@/lib/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { requireTenantContext, hasPermission } from '@/lib/auth/context';
import { visibleRepIds } from '@/lib/auth/team-scope';
import { upsertDealSchema } from '@/lib/validation/schemas';
import { apiError } from '@/lib/api/errors';
import { titleCaseName } from '@/lib/utils';
import { triggerSync } from '@/lib/sheets/sync';

// Deal edits / deletions must reflect immediately in every dropdown across
// the app. No caching of this endpoint.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    const url = new URL(req.url);

    // Optional rep filter:
    //  - `?mine=1` → scope to the current user's deals (assignedRepId = me)
    //  - `?repId=<uuid>` → admin can filter to a specific rep's deals
    //  - default → all company deals (admin-style view)
    //
    // Privacy rule: when the calling user is role='rep', we force the scope
    // to `mine` regardless of what the URL says. This is the server-side
    // guard for the "reps should only see funded deals assigned to them"
    // requirement. Admins (master_admin / company_admin) bypass the lock.
    const isAdmin = ctx.user.role === 'master_admin' || ctx.user.role === 'company_admin';
    const wantMine = url.searchParams.get('mine') === '1';
    const wantRepId = url.searchParams.get('repId');

    const conditions = [
      eq(deals.companyId, ctx.companyId),
      // Hard rule: deleted deals never appear in any list, dropdown, or
      // downstream view. They stay in the DB (audit trail) but are filtered
      // out at every read.
      eq(deals.isDeleted, false),
    ];
    if (!isAdmin) {
      // Non-admins see their OWN deals — plus, for team leaders, the deals of
      // reps on the team(s) they lead. `mine=1` still narrows a leader back to
      // just their own so the toggle works for them too.
      if (wantMine) {
        conditions.push(eq(deals.assignedRepId, ctx.user.id));
      } else {
        const scope = await visibleRepIds(ctx.user.id);
        conditions.push(
          scope.length === 1
            ? eq(deals.assignedRepId, scope[0])
            : inArray(deals.assignedRepId, scope)
        );
      }
    } else if (wantMine) {
      conditions.push(eq(deals.assignedRepId, ctx.user.id));
    } else if (wantRepId) {
      conditions.push(eq(deals.assignedRepId, wantRepId));
    }

    const list = await db.select().from(deals)
      .where(and(...conditions))
      .orderBy(desc(deals.createdAt));

    // Attach an offers summary to every deal so the list view + CSV export
    // show full offer details WITHOUT expanding each row. One query covers
    // all returned deals; accepted offers sort first.
    const ids = list.map((d) => d.id);
    const offerRows = ids.length
      ? await db.select().from(dealOffers).where(inArray(dealOffers.dealId, ids))
      : [];
    const fmtMoney = (v: string | null) =>
      v != null ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '';
    const describeOffer = (o: typeof offerRows[number]) => {
      const parts: string[] = [];
      if (o.fundingAmount != null) parts.push(fmtMoney(o.fundingAmount));
      if (o.factorRate != null) parts.push(`@ ${Number(o.factorRate)}`);
      if (o.termCount != null) parts.push(`${o.termCount} ${o.termMode ?? ''}`.trim());
      if (o.fees != null) parts.push(`${Number(o.fees)}% fee`);
      if (o.paymentAmount != null) parts.push(`${fmtMoney(o.paymentAmount)}/pmt`);
      if (o.notes) parts.push(o.notes);
      let s = parts.join(' · ');
      if (o.isReverseConsolidation) s = `[RC] ${s}`;
      if (o.isAccepted) s = `★ ${s}`;
      return s || 'offer logged (no details)';
    };
    const byDeal = new Map<string, string[]>();
    for (const o of [...offerRows].sort((a, b) => Number(b.isAccepted) - Number(a.isAccepted))) {
      const arr = byDeal.get(o.dealId) ?? [];
      arr.push(describeOffer(o));
      byDeal.set(o.dealId, arr);
    }
    const enriched = list.map((d) => {
      const offs = byDeal.get(d.id) ?? [];
      return { ...d, offersCount: offs.length, offersText: offs.join(' | ') };
    });

    return NextResponse.json({ deals: enriched, data: enriched });
  } catch (e) { return apiError(e); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantContext();
    // Either deals.shop (rep creating during shop flow) OR deals.edit (admin/manual create)
    if (!hasPermission(ctx.user, 'deals.shop') && !hasPermission(ctx.user, 'deals.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = upsertDealSchema.parse(await req.json());

    // Verify assignedRepId is in this company
    if (body.assignedRepId) {
      const [rep] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, body.assignedRepId), eq(users.companyId, ctx.companyId))).limit(1);
      if (!rep) return NextResponse.json({ error: 'Assigned rep not in this company' }, { status: 400 });
    }

    const [d] = await db.insert(deals).values({
      companyId: ctx.companyId,
      name: body.name,
      // Names are normalized to title case (first letter of each name part
      // capitalized) so "john" / "JOHN" both store as "John" — consistent
      // everywhere regardless of how the rep typed it.
      merchantFirstName: body.merchantFirstName ? titleCaseName(body.merchantFirstName) : null,
      merchantLastName: body.merchantLastName ? titleCaseName(body.merchantLastName) : null,
      merchantEmail: body.merchantEmail || null,
      merchantPhone: body.merchantPhone ?? null,
      dealType: body.dealType ?? 'standard_mca',
      offerNotes: body.offerNotes ?? null,
      offerAmount: body.offerAmount != null ? String(body.offerAmount) : null,
      assignedRepId: body.assignedRepId ?? null,
      // New deals default to 'submitted' (modern enum); legacy 'shopping' kept
      // only for existing rows. Caller may still send 'shopping' explicitly.
      status: body.status ?? 'submitted',
      createdBy: ctx.user.id,
    }).returning();
    triggerSync(ctx.companyId);
    return NextResponse.json({ deal: d });
  } catch (e) { return apiError(e); }
}
