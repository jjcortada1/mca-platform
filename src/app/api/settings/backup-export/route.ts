import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import {
  companies, users, funders, funderContacts, funderTiers,
  funderTierAssignments, funderRestrictedStates, funderRestrictedIndustries,
  deals, submissions, submissionFunders, submissionEmails, fundedEntries,
  infoEntries, matchOptions, leadSources, dealCommissions,
  leadSourceCommissions, accountingEntries, commissionPayments,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { requireCompanyAdmin } from '@/lib/auth/context';
import { apiError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/backup-export
 *
 * Returns a complete JSON snapshot of every important table for the
 * caller's company. Streamed as a downloadable file.
 *
 * What's included:
 *   - companies (your own row only), users (without password hashes),
 *     funders + all related child tables, deals, submissions, lead sources,
 *     commissions, payments, accounting, etc.
 *
 * What's NOT included:
 *   - password hashes (security)
 *   - encrypted SMTP / sheets credentials (security)
 *   - other companies' data (tenant isolation)
 *
 * The file is self-describing and human-readable. To restore, an admin
 * would import these rows back into a fresh DB (or open the file in any
 * JSON viewer to see exactly what was in the CRM at the moment of export).
 */
export async function GET() {
  try {
    const ctx = await requireCompanyAdmin();
    const cid = ctx.companyId;

    // Fetch every relevant table. Each query is filtered by companyId where
    // applicable. We strip passwordHash / smtpConfig / encryptedCredentials
    // before serializing so nothing sensitive ends up in the export.
    const [
      companyRows, userRows, funderRows, funderContactRows, funderTierRows,
      tierAssignmentRows, restrictedStateRows, restrictedIndustryRows,
      dealRows, submissionRows, submissionFunderRows, submissionEmailRows,
      fundedRows, infoRows, matchOptRows, leadSourceRows, dcRows,
      lscRows, accRows, payRows,
    ] = await Promise.all([
      db.select().from(companies).where(eq(companies.id, cid)),
      db.select().from(users).where(eq(users.companyId, cid)),
      db.select().from(funders).where(eq(funders.companyId, cid)),
      // Children of funders — filter via a subquery on companyId would be
      // ideal but the simpler approach is to first pull funder ids and
      // filter children by inclusion. The dataset is small per tenant so
      // we just pull all and trust the FK.
      db.select().from(funderContacts),
      db.select().from(funderTiers).where(eq(funderTiers.companyId, cid)),
      db.select().from(funderTierAssignments),
      db.select().from(funderRestrictedStates),
      db.select().from(funderRestrictedIndustries),
      db.select().from(deals).where(eq(deals.companyId, cid)),
      db.select().from(submissions).where(eq(submissions.companyId, cid)),
      db.select().from(submissionFunders),
      db.select().from(submissionEmails),
      db.select().from(fundedEntries).where(eq(fundedEntries.companyId, cid)),
      db.select().from(infoEntries).where(eq(infoEntries.companyId, cid)),
      db.select().from(matchOptions).where(eq(matchOptions.companyId, cid)),
      db.select().from(leadSources).where(eq(leadSources.companyId, cid)),
      db.select().from(dealCommissions).where(eq(dealCommissions.companyId, cid)),
      db.select().from(leadSourceCommissions).where(eq(leadSourceCommissions.companyId, cid)),
      db.select().from(accountingEntries).where(eq(accountingEntries.companyId, cid)),
      db.select().from(commissionPayments).where(eq(commissionPayments.companyId, cid)),
    ]);

    // Filter children that may belong to other tenants (we pulled them all
    // for the join — strip anything whose parent isn't ours).
    const funderIds = new Set(funderRows.map((f) => f.id));
    const submissionIds = new Set(submissionRows.map((s) => s.id));
    const submissionFunderIds = new Set(
      submissionFunderRows.filter((sf) => submissionIds.has(sf.submissionId)).map((sf) => sf.id)
    );

    const sanitizedUsers = userRows.map((u) => {
      // Strip secrets before export. The pluck pattern keeps the body free of
      // anything that could be used to log in as the user from a leaked file.
      const { passwordHash: _ph, smtpConfig: _smtp, ...rest } = u;
      return rest;
    });
    const sanitizedCompanies = companyRows.map((c) => {
      const { smtpConfig: _smtp, ...rest } = c;
      return rest;
    });

    const snapshot = {
      _meta: {
        format: 'cortada-crm-export-v1',
        exportedAt: new Date().toISOString(),
        companyId: cid,
        exportedBy: ctx.user.email,
        note: 'This file contains a full snapshot of the CRM data for your company. Keep it safe — it includes business records. Passwords and SMTP credentials are intentionally excluded.',
      },
      companies: sanitizedCompanies,
      users: sanitizedUsers,
      funderTiers: funderTierRows,
      funders: funderRows,
      funderTierAssignments: tierAssignmentRows.filter((a) => funderIds.has(a.funderId)),
      funderContacts: funderContactRows.filter((c) => funderIds.has(c.funderId)),
      funderRestrictedStates: restrictedStateRows.filter((r) => funderIds.has(r.funderId)),
      funderRestrictedIndustries: restrictedIndustryRows.filter((r) => funderIds.has(r.funderId)),
      deals: dealRows,
      submissions: submissionRows,
      submissionFunders: submissionFunderRows.filter((sf) => submissionIds.has(sf.submissionId)),
      submissionEmails: submissionEmailRows.filter((se) => submissionFunderIds.has(se.submissionFunderId)),
      fundedEntries: fundedRows,
      infoEntries: infoRows,
      matchOptions: matchOptRows,
      leadSources: leadSourceRows,
      dealCommissions: dcRows,
      leadSourceCommissions: lscRows,
      accountingEntries: accRows,
      commissionPayments: payRows,
    };

    const filename = `cortada-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
