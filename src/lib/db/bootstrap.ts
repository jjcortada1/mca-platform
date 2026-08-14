/**
 * Startup schema bootstrap — keeps the live database aligned with the code.
 *
 * WHY THIS EXISTS: the app is deployed by uploading new code onto a host
 * that already has a database (Replit + Neon). There is no CI step that
 * runs `drizzle-kit push`, so a new code column (e.g. users.two_factor_enabled)
 * silently breaks EVERY query on that table until someone remembers to
 * migrate. That is exactly how deal submissions stopped sending.
 *
 * This module runs a fixed list of IDEMPOTENT statements
 * (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS) on server boot.
 * Safe to run any number of times; each statement is a no-op when the
 * schema is already current. When adding a feature that needs new
 * columns/tables, append the SQL here as well as in schema.ts.
 */

import { getRawSql } from './client';

let bootstrapPromise: Promise<void> | null = null;

const STATEMENTS: string[] = [
  // ---- companies: platform-owner flag (gates /master company management
  //      for company_admin users of the operator's own company) ----
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_platform_owner boolean NOT NULL DEFAULT false`,
  // Backfill: the FIRST company ever created is the operator's. Only runs
  // when no owner is flagged yet, so a manual change sticks.
  `UPDATE companies SET is_platform_owner = true
     WHERE id = (SELECT id FROM companies ORDER BY created_at ASC LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM companies WHERE is_platform_owner = true)`,

  // ---- users: signature + 2FA columns (2FA added 2026-06; the rest are
  //      older but cheap to re-assert for installs that predate them) ----
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_signature text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_logo_url text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_link varchar(500)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS always_cc_email varchar(255)`,
  // Widen always_cc_email to hold multiple comma-separated addresses.
  // Idempotent: re-running TYPE text on an already-text column is a no-op.
  `ALTER TABLE users ALTER COLUMN always_cc_email TYPE text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false`,

  // ---- deals: funded-deal detail + intake columns ----
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS funded_sub_status varchar(24)`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS funded_with_funder_id uuid REFERENCES funders(id) ON DELETE SET NULL`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS funded_with_name varchar(200)`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS funded_notes text`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS submission_intake jsonb`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS refinanced_from_deal_id uuid`,
  // Saved funded-email recipients — table may predate bootstrap coverage on
  // some installs, so create-if-missing before altering.
  `CREATE TABLE IF NOT EXISTS funded_email_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    email varchar(255) NOT NULL,
    company varchar(200),
    notes text,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE funded_email_contacts ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false`,
  `ALTER TABLE esign_requests ADD COLUMN IF NOT EXISTS application_url text`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS sidebar_hidden_items jsonb`,
  `ALTER TABLE funder_tiers ADD COLUMN IF NOT EXISTS description text`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS offer_amount numeric(14,2)`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS net_amount numeric(14,2)`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_type varchar(30) NOT NULL DEFAULT 'standard_mca'`,
  // Payment pause / temporary modification on funded deals (additive).
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS payments_paused boolean NOT NULL DEFAULT false`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS payments_paused_at timestamptz`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS modified_payment_amount numeric(14,2)`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS modified_payment_until timestamptz`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS payment_modification_note text`,
  // Application-link email (replaces the Dropbox Sign API flow).
  `ALTER TABLE esign_config ADD COLUMN IF NOT EXISTS application_url text`,
  `ALTER TABLE esign_config ADD COLUMN IF NOT EXISTS email_body text`,

  // ---- submission_funders: intake notes stored per funder submission ----
  `ALTER TABLE submission_funders ADD COLUMN IF NOT EXISTS notes text`,

  // ---- funders: multi-email + legacy-CRM subject compatibility ----
  `ALTER TABLE funders ADD COLUMN IF NOT EXISTS emails jsonb`,
  `ALTER TABLE funders ADD COLUMN IF NOT EXISTS phones jsonb`,
  `ALTER TABLE funders ADD COLUMN IF NOT EXISTS plain_subject_only boolean NOT NULL DEFAULT false`,

  // ---- verification_codes: email OTP storage (2FA + password change) ----
  `CREATE TABLE IF NOT EXISTS verification_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose varchar(40) NOT NULL,
    code_hash varchar(255) NOT NULL,
    payload text,
    attempts integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS verification_codes_user_purpose_idx
     ON verification_codes (user_id, purpose)`,

  // ---- teams & tasks (added 2026-07) ----
  `CREATE TABLE IF NOT EXISTS teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS teams_company_idx ON teams (company_id)`,

  `CREATE TABLE IF NOT EXISTS team_members (
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_leader boolean NOT NULL DEFAULT false,
    PRIMARY KEY (team_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title varchar(300) NOT NULL,
    description text,
    assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
    due_date timestamptz,
    status varchar(20) NOT NULL DEFAULT 'open',
    handled_by uuid REFERENCES users(id) ON DELETE SET NULL,
    completed_at timestamptz,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    is_deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_company_idx ON tasks (company_id)`,
  `CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assigned_to_user_id)`,

  // ---- app_flags: one-time migration markers (guards backfills that must
  //      run exactly once, unlike the idempotent statements above) ----
  `CREATE TABLE IF NOT EXISTS app_flags (
    key varchar(64) PRIMARY KEY,
    value text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // 2FA is on by default for every NEW account (login fails open when no
  // email transport exists, so this can't lock anyone out).
  `ALTER TABLE users ALTER COLUMN two_factor_enabled SET DEFAULT true`,

  // ---- companies: per-tenant feature access (null = everything) ----
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS enabled_nav_items jsonb`,

  // ---- companies: automatic backup settings (additive) ----
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_backup_enabled boolean NOT NULL DEFAULT true`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS backup_email varchar(320)`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_backup_at timestamptz`,

  // ---- data_backups: point-in-time JSON snapshots (additive safety net) ----
  `CREATE TABLE IF NOT EXISTS data_backups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    kind varchar(12) NOT NULL DEFAULT 'auto',
    content text NOT NULL,
    byte_size integer NOT NULL DEFAULT 0,
    row_counts jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS data_backups_company_idx ON data_backups (company_id)`,

  // ---- syndication board (added 2026-07, additive) ----
  `CREATE TABLE IF NOT EXISTS syndication_deals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
    deal_name varchar(300) NOT NULL,
    funding_amount numeric(14,2),
    term varchar(120),
    rate varchar(60),
    commission varchar(120),
    fee varchar(120),
    has_early_payoff boolean NOT NULL DEFAULT false,
    early_payoff_details text,
    funder_name varchar(200),
    position_number varchar(20),
    notes text,
    status varchar(20) NOT NULL DEFAULT 'open',
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    is_deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS syndication_deals_company_idx ON syndication_deals (company_id)`,
  `CREATE TABLE IF NOT EXISTS syndication_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    syndication_deal_id uuid NOT NULL REFERENCES syndication_deals(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    rep_name varchar(200) NOT NULL,
    company_name varchar(200),
    amount numeric(14,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS syndication_entries_deal_idx ON syndication_entries (syndication_deal_id)`,
  `CREATE TABLE IF NOT EXISTS syndication_reps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    rep_name varchar(200) NOT NULL,
    rep_company_name varchar(200),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS syndication_reps_company_idx ON syndication_reps (company_id)`,
  // Available-for-syndication cap (dollar OR percent of funding amount).
  `ALTER TABLE syndication_deals ADD COLUMN IF NOT EXISTS available_amount numeric(14,2)`,
  `ALTER TABLE syndication_deals ADD COLUMN IF NOT EXISTS available_pct numeric(6,2)`,
  // Offers can be flagged as reverse consolidations.
  `ALTER TABLE deal_offers ADD COLUMN IF NOT EXISTS is_reverse_consolidation boolean NOT NULL DEFAULT false`,

  // ---- funder bonuses (additive) ----
  `CREATE TABLE IF NOT EXISTS funder_bonuses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    funder_id uuid REFERENCES funders(id) ON DELETE SET NULL,
    funder_name varchar(200) NOT NULL,
    bonus text NOT NULL,
    conditions text,
    start_date timestamptz,
    end_date timestamptz,
    is_running boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    is_deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS funder_bonuses_company_idx ON funder_bonuses (company_id)`,

  // ---- notifications (additive) ----
  `CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title varchar(300) NOT NULL,
    body text,
    link varchar(500),
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at)`,

  // ---- worksheets: personal sheets + per-sheet cross-company shares ----
  `CREATE TABLE IF NOT EXISTS worksheets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    columns jsonb NOT NULL DEFAULT '[]'::jsonb,
    sort_order integer NOT NULL DEFAULT 0,
    is_deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS worksheets_owner_idx ON worksheets (owner_user_id)`,
  `CREATE TABLE IF NOT EXISTS worksheet_rows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worksheet_id uuid NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
    cells jsonb NOT NULL DEFAULT '{}'::jsonb,
    sort_order integer NOT NULL DEFAULT 0,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS worksheet_rows_sheet_idx ON worksheet_rows (worksheet_id)`,
  `CREATE TABLE IF NOT EXISTS worksheet_shares (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worksheet_id uuid NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email varchar(320) NOT NULL,
    role varchar(10) NOT NULL DEFAULT 'view',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS worksheet_shares_sheet_idx ON worksheet_shares (worksheet_id)`,

  // ---- e-sign / Dropbox Sign (additive) ----
  `CREATE TABLE IF NOT EXISTS esign_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    api_key_encrypted text,
    template_id varchar(120),
    signer_role varchar(100),
    subject varchar(200),
    message text,
    test_mode boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS esign_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    recipient_name varchar(200) NOT NULL,
    recipient_email varchar(320) NOT NULL,
    signature_request_id varchar(120),
    status varchar(30) NOT NULL DEFAULT 'sent',
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS esign_requests_company_idx ON esign_requests (company_id)`,

  // ---- push subscriptions (Web Push endpoints, additive) ----
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id)`,

  // ---- funded approvals (additive) ----
  `CREATE TABLE IF NOT EXISTS funded_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
    deal_name varchar(300),
    rep_id uuid REFERENCES users(id) ON DELETE SET NULL,
    funded_amount numeric(14,2),
    factor_rate numeric(8,4),
    term_details varchar(200),
    funder_name varchar(200),
    gross_commission numeric(14,2),
    rep_split_pct numeric(6,2),
    notes text,
    payload jsonb,
    status varchar(20) NOT NULL DEFAULT 'pending',
    submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS funded_approvals_company_idx ON funded_approvals (company_id, status)`,
];

/**
 * DATA-SAFETY GUARD.
 *
 * Every bootstrap statement MUST be additive (ADD COLUMN / CREATE TABLE /
 * CREATE INDEX / SET DEFAULT / a guarded flag UPDATE) and never destroy data.
 * This guard scans the statement list at boot and refuses to run anything
 * that looks destructive — DROP TABLE, DROP COLUMN, TRUNCATE, DELETE, etc.
 * If one ever slips in (e.g. a future edit), it's skipped and loudly logged
 * instead of silently wiping data. Preserving existing users/deals/funders/
 * commissions/submissions/settings takes priority over any schema change.
 */
const DESTRUCTIVE = /\b(drop\s+table|drop\s+column|drop\s+database|drop\s+schema|truncate|delete\s+from)\b/i;
function isDestructive(stmt: string): boolean {
  return DESTRUCTIVE.test(stmt);
}

/**
 * One-time backfills — each runs exactly once, tracked in app_flags.
 * Unlike STATEMENTS these change DATA, so re-running them would stomp on
 * choices users made since (e.g. someone who turned 2FA back off).
 */
const ONE_TIME_BACKFILLS: { flag: string; sql: string }[] = [
  {
    // Enable email-code 2FA for every existing account (2026-07 policy).
    // Users can still turn it off per-account afterwards; this only runs once.
    flag: 'two_factor_enable_all_v1',
    sql: `UPDATE users SET two_factor_enabled = true`,
  },

  // ---- connected email accounts (Gmail OAuth) ----
  // Additive: SMTP config on companies/users is untouched and stays the
  // fallback for anyone who hasn't connected a mailbox.
  `CREATE TABLE IF NOT EXISTS email_accounts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     provider varchar(20) NOT NULL DEFAULT 'google',
     email_address varchar(320) NOT NULL,
     display_name varchar(200),
     access_token text NOT NULL,
     refresh_token text,
     token_expires_at timestamptz,
     scope text NOT NULL DEFAULT '',
     status varchar(20) NOT NULL DEFAULT 'connected',
     last_error text,
     history_id varchar(50),
     last_sync_at timestamptz,
     sync_enabled boolean NOT NULL DEFAULT true,
     send_enabled boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS email_accounts_user_idx ON email_accounts (user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS email_accounts_user_provider_email_idx
     ON email_accounts (user_id, provider, email_address)`,

  // ---- court searches (NY WebCivil Supreme public-record lookups) ----
  `CREATE TABLE IF NOT EXISTS court_searches (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,
     search_type varchar(16) NOT NULL,
     business_name varchar(300),
     first_name varchar(120),
     last_name varchar(120),
     provider varchar(40) NOT NULL DEFAULT 'ny_webcivil',
     status varchar(24) NOT NULL,
     error text,
     result_count integer NOT NULL DEFAULT 0,
     results jsonb NOT NULL DEFAULT '[]'::jsonb,
     diagnostics jsonb,
     created_by uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS court_searches_company_idx ON court_searches (company_id)`,
  `CREATE INDEX IF NOT EXISTS court_searches_deal_idx ON court_searches (deal_id)`,

  // ---- demo mode (platform owner only) ----
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_company_id uuid`,
];

/**
 * Run all bootstrap statements once per process. Failures on individual
 * statements are logged and skipped — a partially-migrated schema is
 * strictly better than a server that refuses to boot, and the statement
 * will retry on next restart.
 */
export function ensureSchema(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    if (!process.env.DATABASE_URL) return; // build-time: no DB, nothing to do
    const sql = getRawSql();
    for (const stmt of STATEMENTS) {
      // Safety: never run a destructive statement, even if one was added by
      // mistake. Additive-only is a hard rule — data is never dropped/cleared.
      if (isDestructive(stmt)) {
        console.error('[db-bootstrap] BLOCKED destructive statement (not run):',
          stmt.slice(0, 80).replace(/\s+/g, ' '));
        continue;
      }
      try {
        await sql.unsafe(stmt);
      } catch (err) {
        console.error('[db-bootstrap] statement failed (continuing):',
          stmt.slice(0, 80).replace(/\s+/g, ' '),
          err instanceof Error ? err.message : err);
      }
    }
    for (const b of ONE_TIME_BACKFILLS) {
      try {
        const rows = await sql`SELECT 1 FROM app_flags WHERE key = ${b.flag} LIMIT 1`;
        if (rows.length === 0) {
          await sql.unsafe(b.sql);
          await sql`INSERT INTO app_flags (key, value) VALUES (${b.flag}, 'done') ON CONFLICT (key) DO NOTHING`;
          console.log(`[db-bootstrap] backfill applied: ${b.flag}`);
        }
      } catch (err) {
        console.error('[db-bootstrap] backfill failed (continuing):', b.flag,
          err instanceof Error ? err.message : err);
      }
    }
    console.log('[db-bootstrap] schema check complete');
  })();
  return bootstrapPromise;
}
