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
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false`,

  // ---- deals: funded-deal detail + intake columns ----
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS funded_sub_status varchar(24)`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS funded_with_funder_id uuid REFERENCES funders(id) ON DELETE SET NULL`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS funded_with_name varchar(200)`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS funded_notes text`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS submission_intake jsonb`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS offer_amount numeric(14,2)`,
  `ALTER TABLE deals ADD COLUMN IF NOT EXISTS net_amount numeric(14,2)`,

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
];

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
