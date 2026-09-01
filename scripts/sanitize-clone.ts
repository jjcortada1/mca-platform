/**
 * Sanitize a COPY of the production database for a developer environment.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 * You want a working copy of the CRM — real funders, real settings, real
 * shape — with every merchant, deal, funding and commission record removed,
 * so a contractor can build against something realistic without ever
 * holding a customer's information.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * THIS IS DESTRUCTIVE. It deletes rows permanently. It is meant to be run
 * against a RESTORED COPY of the database and never against production.
 * Three separate guards enforce that; see assertSafeTarget() below.
 *
 * HOW TO USE IT
 *   1. Take a dump of production and restore it into a NEW, SEPARATE
 *      database (a new Neon project — not a branch of the live one).
 *   2. Point this script at the copy and preview what it will do:
 *        SANITIZE_DATABASE_URL='postgres://...copy...' npm run sanitize -- --dry-run
 *   3. Read the plan. If it looks right, run it for real:
 *        SANITIZE_DATABASE_URL='postgres://...copy...' \
 *        SANITIZE_CONFIRM='I-HAVE-CHECKED-THIS-IS-A-COPY' npm run sanitize
 *   4. Read the verification report it prints at the end.
 *
 * WHY THE TABLE MAP IS EXHAUSTIVE
 * Every table in the schema must appear in TABLE_PLAN below. If a table
 * exists in the database that is not listed, the script REFUSES TO RUN.
 * That is deliberate: the failure mode that matters here is a table added
 * six months from now that quietly keeps merchant data in every copy
 * anybody makes. Better to fail loudly and make someone classify it.
 */

/*
 * The driver is imported lazily inside main(), AFTER the safety guards run.
 * A top-level import means a mis-set environment variable fails with
 * "cannot find module" instead of the guard message that explains what to
 * do — and it makes the guards untestable without a database driver present.
 */
type Sql = import('postgres').Sql;
type Tx = import('postgres').TransactionSql;

/* ───────────────────────────── the plan ───────────────────────────── */

type Action =
  /** Left completely alone. */
  | 'keep'
  /** Every row deleted. */
  | 'purge'
  /** Rows kept, listed columns set to NULL. */
  | { scrub: string[] }
  /** Rows kept, but identifying values replaced. Handled case by case. */
  | 'anonymize';

interface Entry { action: Action; why: string }

const TABLE_PLAN: Record<string, Entry> = {
  /* ── Merchant, deal and funding records — the whole point of this ── */
  deals:                    { action: 'purge', why: 'Merchant names, emails, phones, funding terms' },
  deal_offers:              { action: 'purge', why: 'Offers made on merchant deals' },
  deal_syndications:        { action: 'purge', why: 'Syndication participation per deal' },
  submissions:              { action: 'purge', why: 'Which merchant went to which funder' },
  submission_funders:       { action: 'purge', why: 'Per-funder outcomes on merchant deals' },
  submission_emails:        { action: 'purge', why: 'Full bodies of emails sent about merchants' },
  funded_entries:           { action: 'purge', why: 'The funded board — amounts and dates' },
  funded_approvals:         { action: 'purge', why: 'Pending funded submissions awaiting approval' },
  deal_commissions:         { action: 'purge', why: 'Funded amounts, rates and rep commissions' },
  lead_source_commissions:  { action: 'purge', why: 'Payouts owed on funded deals' },
  accounting_entries:       { action: 'purge', why: 'Financial records tied to funded deals' },
  commission_payments:      { action: 'purge', why: 'Money actually paid out' },
  commission_draws:         { action: 'purge', why: 'Advances against commission' },
  syndication_deals:        { action: 'purge', why: 'Deal names and funding amounts on the syndication board' },
  syndication_entries:      { action: 'purge', why: 'Who syndicated into which deal' },
  syndication_reps:         { action: 'purge', why: 'Outside participants, by name' },
  court_searches:           { action: 'purge', why: 'Searched business and owner names, plus results' },
  esign_requests:           { action: 'purge', why: 'Merchant names and emails sent for signature' },
  tasks:                    { action: 'purge', why: 'Task titles routinely name merchants' },
  notifications:            { action: 'purge', why: 'Notification text references deals by name' },
  worksheets:               { action: 'purge', why: 'Personal tracking sheets — outside deals, merchant details' },
  worksheet_rows:           { action: 'purge', why: 'Cell contents of those sheets' },
  worksheet_shares:         { action: 'purge', why: 'Who those sheets were shared with' },
  data_backups:             { action: 'purge', why: 'Snapshots that would reintroduce everything above' },
  lead_sources:             { action: 'purge', why: 'Named individuals and their contact details' },
  funded_email_contacts:    { action: 'purge', why: 'Saved recipient lists that may include merchants' },

  /* ── Credentials and tokens — never copy these anywhere ── */
  email_accounts:           { action: 'purge', why: 'Gmail OAuth access and refresh tokens' },
  push_subscriptions:       { action: 'purge', why: 'Device push endpoints' },
  password_resets:          { action: 'purge', why: 'Live password reset tokens' },
  verification_codes:       { action: 'purge', why: 'Live 2FA and verification codes' },

  /* ── Funder directory — kept, this is what makes the copy useful ── */
  funders:                     { action: 'keep', why: 'Funder directory' },
  funder_contacts:             { action: 'keep', why: 'Funder-side contacts' },
  funder_tiers:                { action: 'keep', why: 'Tier definitions' },
  funder_tier_assignments:     { action: 'keep', why: 'Funder-to-tier mapping' },
  funder_restricted_states:    { action: 'keep', why: 'Matching rules' },
  funder_restricted_industries:{ action: 'keep', why: 'Matching rules' },
  funder_bonuses:              { action: 'keep', why: 'Funder bonus programs' },
  master_default_funders:      { action: 'keep', why: 'Platform-level funder defaults' },

  /* ── Configuration — kept so the app behaves normally ── */
  commission_rules:         { action: 'keep', why: 'Rate thresholds; configuration, not records' },
  structured_email_fields:  { action: 'keep', why: 'Email template field definitions' },
  match_options:            { action: 'keep', why: 'Matching dropdown options' },
  info_entries:             { action: 'keep', why: 'Knowledge base — REVIEW THESE BY HAND, free text' },
  teams:                    { action: 'keep', why: 'Team structure' },
  team_members:             { action: 'keep', why: 'Team membership' },
  permissions:              { action: 'keep', why: 'Per-user permission grants' },

  /* ── Kept, but with secrets removed ── */
  companies: {
    action: { scrub: ['smtp_config', 'email_signature'] },
    why: 'Kept for branding and settings; SMTP credentials removed',
  },
  esign_config: {
    action: { scrub: ['api_key_encrypted'] },
    why: 'Kept for shape; Dropbox Sign API key removed',
  },
  sheet_sync_config: {
    action: { scrub: ['encrypted_credentials', 'service_account_email', 'spreadsheet_id'] },
    why: 'Kept for shape; Google service-account credentials removed',
  },
  users: {
    action: 'anonymize',
    why: 'Staff names and emails replaced; passwords made unusable',
  },
};

/* ─────────────────────────── safety guards ─────────────────────────── */

const CONFIRM_PHRASE = 'I-HAVE-CHECKED-THIS-IS-A-COPY';

function assertSafeTarget(): { url: string; dryRun: boolean } {
  const dryRun = process.argv.includes('--dry-run');

  /* Guard 1 — a dedicated variable. Deliberately NOT DATABASE_URL, so this
     can never pick up the application's own connection by accident, and so
     running it with a normal shell environment does nothing at all. */
  const url = process.env.SANITIZE_DATABASE_URL;
  if (!url) {
    fail(
      'SANITIZE_DATABASE_URL is not set.',
      'Set it to the connection string of the COPY you want to sanitize.',
      'This script never reads DATABASE_URL, so it cannot pick up production by mistake.',
    );
  }

  /* Guard 2 — it must not be the same database the app is pointed at. */
  const appUrl = process.env.DATABASE_URL;
  if (appUrl && sameDatabase(appUrl, url!)) {
    fail(
      'SANITIZE_DATABASE_URL points at the SAME database as DATABASE_URL.',
      'That is production. Restore a dump into a separate database first.',
    );
  }

  /* Guard 3 — an explicit, typed-out confirmation for the destructive run. */
  if (!dryRun && process.env.SANITIZE_CONFIRM !== CONFIRM_PHRASE) {
    fail(
      'Refusing to delete anything without confirmation.',
      `Re-run with SANITIZE_CONFIRM='${CONFIRM_PHRASE}'`,
      'Or pass --dry-run to preview the plan without touching data.',
    );
  }

  return { url: url!, dryRun };
}

/** Compare host + database name, ignoring credentials and query params. */
function sameDatabase(a: string, b: string): boolean {
  try {
    const pa = new URL(a);
    const pb = new URL(b);
    return pa.host.toLowerCase() === pb.host.toLowerCase()
      && pa.pathname.toLowerCase() === pb.pathname.toLowerCase();
  } catch {
    // If either is unparseable, be conservative and treat them as the same.
    return true;
  }
}

function fail(...lines: string[]): never {
  console.error('\n  ✗ ' + lines[0]);
  for (const l of lines.slice(1)) console.error('    ' + l);
  console.error('');
  process.exit(1);
}

/* ───────────────────────────── the run ───────────────────────────── */

async function main() {
  const { url, dryRun } = assertSafeTarget();

  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    const target = new URL(url);
    console.log('');
    console.log(`  Target   ${target.host}${target.pathname}`);
    console.log(`  Mode     ${dryRun ? 'DRY RUN — nothing will be changed' : 'LIVE — rows will be deleted permanently'}`);
    console.log('');

    /* ── Every table in the database must be accounted for ── */
    const present = (await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `).map((r) => r.table_name);

    const known = new Set(Object.keys(TABLE_PLAN));
    const unclassified = present.filter((t) => !known.has(t) && t !== 'app_flags' && !t.startsWith('drizzle'));
    if (unclassified.length) {
      fail(
        `${unclassified.length} table(s) in this database are not classified in TABLE_PLAN:`,
        '  ' + unclassified.join(', '),
        'Add each one to scripts/sanitize-clone.ts as keep or purge before running.',
        'Refusing to continue — an unclassified table could be carrying merchant data.',
      );
    }

    const missing = [...known].filter((t) => !present.includes(t));
    if (missing.length) {
      console.log(`  Note: ${missing.length} planned table(s) not present here (fine): ${missing.join(', ')}`);
      console.log('');
    }

    /* ── Counts before ── */
    const before = await countRows(sql, present);

    /* ── Show the plan ── */
    const purge = present.filter((t) => TABLE_PLAN[t]?.action === 'purge');
    const scrub = present.filter((t) => typeof TABLE_PLAN[t]?.action === 'object');
    const anon  = present.filter((t) => TABLE_PLAN[t]?.action === 'anonymize');
    const keep  = present.filter((t) => TABLE_PLAN[t]?.action === 'keep');

    console.log('  DELETE ALL ROWS');
    for (const t of purge) {
      console.log(`    ${pad(t)} ${String(before[t] ?? 0).padStart(7)} rows   ${TABLE_PLAN[t].why}`);
    }
    console.log('');
    console.log('  KEEP ROWS, REMOVE SECRETS');
    for (const t of [...scrub, ...anon]) {
      console.log(`    ${pad(t)} ${String(before[t] ?? 0).padStart(7)} rows   ${TABLE_PLAN[t].why}`);
    }
    console.log('');
    console.log('  LEAVE ALONE');
    for (const t of keep) {
      console.log(`    ${pad(t)} ${String(before[t] ?? 0).padStart(7)} rows   ${TABLE_PLAN[t].why}`);
    }
    console.log('');

    if (dryRun) {
      console.log('  Dry run complete. Nothing was changed.');
      console.log(`  To run it for real, add SANITIZE_CONFIRM='${CONFIRM_PHRASE}'`);
      console.log('');
      return;
    }

    /* ── Purge. One transaction, so a failure leaves nothing half-done. ── */
    await sql.begin(async (tx) => {
      // Order does not matter: every one of these is either a child of a
      // purged parent or cascades, and they all go in the same transaction.
      for (const t of purge) {
        await tx.unsafe(`DELETE FROM "${t}"`);
      }

      for (const t of scrub) {
        const cols = (TABLE_PLAN[t].action as { scrub: string[] }).scrub;
        const existing = await columnsOf(tx, t);
        const hit = cols.filter((c) => existing.includes(c));
        if (hit.length) {
          const sets = hit.map((c) => `"${c}" = NULL`).join(', ');
          await tx.unsafe(`UPDATE "${t}" SET ${sets}`);
        }
      }

      if (anon.includes('users')) {
        /* Staff names and email addresses are personal data too, and the
           developer has no need for them. Rows are kept so team structure
           and permissions still resolve; identity and credentials go.
           The password hash is set to a constant that is not a valid bcrypt
           hash, so no password can ever match it. */
        await tx.unsafe(`
          UPDATE users SET
            name           = 'Team Member ' || substr(id::text, 1, 4),
            email          = 'user-' || substr(id::text, 1, 8) || '@example.invalid',
            password_hash  = 'disabled-in-sanitized-copy',
            email_signature = NULL,
            signature_logo_url = NULL,
            signature_link = NULL,
            always_cc_email = NULL,
            smtp_config    = NULL,
            two_factor_enabled = false,
            demo_mode      = false,
            demo_company_id = NULL,
            last_login_at  = NULL
        `);
      }
    });

    /* ── Verify, and say so out loud ── */
    const after = await countRows(sql, present);
    let leaks = 0;
    console.log('  VERIFICATION');
    for (const t of purge) {
      const n = after[t] ?? 0;
      if (n > 0) { leaks++; console.log(`    ✗ ${pad(t)} still has ${n} rows`); }
    }
    if (leaks === 0) console.log('    ✓ every purged table is empty');

    const secretLeaks = await checkSecretsCleared(sql, present);
    for (const msg of secretLeaks) { leaks++; console.log(`    ✗ ${msg}`); }
    if (secretLeaks.length === 0) console.log('    ✓ credential columns are null');

    const remaining = present
      .filter((t) => (after[t] ?? 0) > 0)
      .map((t) => `${t} (${after[t]})`);
    console.log('');
    console.log('  ROWS REMAINING');
    console.log('    ' + (remaining.length ? remaining.join(', ') : 'none'));
    console.log('');

    if (leaks > 0) {
      console.log('  ✗ FINISHED WITH PROBLEMS — do not hand this database over.');
      process.exit(1);
    }
    console.log('  ✓ Sanitized. Funders and settings kept; merchant and funding records gone.');
    console.log('    Check info_entries by hand — it is free text and may mention a merchant.');
    console.log('    Then create yourself a fresh login:  npm run db:seed');
    console.log('');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function countRows(sql: Sql, tables: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    try {
      const [row] = await sql.unsafe<{ n: string }[]>(`SELECT COUNT(*)::text AS n FROM "${t}"`);
      out[t] = Number(row.n);
    } catch { /* table vanished or is not readable — ignore */ }
  }
  return out;
}

async function columnsOf(sql: Sql | Tx, table: string): Promise<string[]> {
  const rows = await sql.unsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '${table}'`,
  );
  return rows.map((r) => r.column_name);
}

/** Re-read the columns we nulled and confirm nothing survived. */
async function checkSecretsCleared(sql: Sql, present: string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const [table, entry] of Object.entries(TABLE_PLAN)) {
    if (typeof entry.action !== 'object' || !present.includes(table)) continue;
    const existing = await columnsOf(sql, table);
    for (const col of entry.action.scrub) {
      if (!existing.includes(col)) continue;
      const [row] = await sql.unsafe<{ n: string }[]>(
        `SELECT COUNT(*)::text AS n FROM "${table}" WHERE "${col}" IS NOT NULL`,
      );
      if (Number(row.n) > 0) problems.push(`${table}.${col} still set on ${row.n} row(s)`);
    }
  }
  if (present.includes('users')) {
    const [row] = await sql.unsafe<{ n: string }[]>(
      `SELECT COUNT(*)::text AS n FROM users WHERE password_hash <> 'disabled-in-sanitized-copy'`,
    );
    if (Number(row.n) > 0) problems.push(`users: ${row.n} account(s) still have a usable password hash`);
  }
  return problems;
}

function pad(s: string): string {
  return (s + ' '.repeat(30)).slice(0, 30);
}

main().catch((err) => {
  console.error('\n  ✗ Failed:', err instanceof Error ? err.message : err, '\n');
  process.exit(1);
});
