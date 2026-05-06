#!/usr/bin/env node
/**
 * First-run setup script for Replit (and local dev).
 *
 * Idempotent — safe to run multiple times. Does the following:
 *   1. Generate ENCRYPTION_KEY (if missing) and persist to .env.local
 *   2. Generate NEXTAUTH_SECRET (if missing) and persist to .env.local
 *   3. Auto-detect NEXTAUTH_URL from Replit env (REPL_SLUG / REPLIT_DEV_DOMAIN)
 *   4. Push DB schema
 *   5. Seed master admin + Cortada company + sample workflow data
 *
 * After this runs once, subsequent boots only need to run `npm run dev`.
 *
 * Required env: DATABASE_URL (Replit Secret or .env.local)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Only these keys are persisted to .env.local. Other env vars (like Replit Secrets)
// are read from process.env at runtime — we don't shadow-write them.
const MANAGED_KEYS = ['DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'ENCRYPTION_KEY',
  'MASTER_ADMIN_EMAIL', 'MASTER_ADMIN_PASSWORD', 'SEED_COMPANY_NAME', 'SEED_COMPANY_SLUG',
  'SEED_COMPANY_ADMIN_EMAIL', 'SEED_COMPANY_ADMIN_PASSWORD', 'SEED_TEST_DATA',
  'SEED_TEST_REP_EMAIL', 'SEED_TEST_REP_PASSWORD',
  'SYSTEM_SMTP_HOST', 'SYSTEM_SMTP_PORT', 'SYSTEM_SMTP_USER', 'SYSTEM_SMTP_PASS', 'SYSTEM_SMTP_FROM'];

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');

// Load existing .env.local if present
let env = {};
if (fs.existsSync(ENV_PATH)) {
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}

// Merge process.env (Replit Secrets win) — only for managed keys
for (const k of MANAGED_KEYS) {
  if (process.env[k]) env[k] = process.env[k];
}

let changed = false;

// ── DATABASE_URL ───────────────────────────────────────────
if (!env.DATABASE_URL) {
  console.error('\n  ✗ DATABASE_URL is not set.\n');
  console.error('     OPTIONS:');
  console.error('     1. (easiest) In Replit, go to Tools → Database → Create database.');
  console.error('        Replit auto-sets DATABASE_URL — restart the Repl after.');
  console.error('     2. Use Neon (free): https://neon.tech → copy connection string');
  console.error('        → Replit Secrets → add DATABASE_URL\n');
  process.exit(1);
}

// ── ENCRYPTION_KEY ─────────────────────────────────────────
if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length !== 64) {
  env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  changed = true;
  console.log('  ✓ Generated ENCRYPTION_KEY');
}

// ── NEXTAUTH_SECRET ────────────────────────────────────────
if (!env.NEXTAUTH_SECRET) {
  env.NEXTAUTH_SECRET = crypto.randomBytes(32).toString('base64');
  changed = true;
  console.log('  ✓ Generated NEXTAUTH_SECRET');
}

// ── NEXTAUTH_URL ───────────────────────────────────────────
if (!env.NEXTAUTH_URL) {
  // Replit gives us the public URL via env vars
  if (process.env.REPLIT_DEV_DOMAIN) {
    env.NEXTAUTH_URL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  } else if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
    env.NEXTAUTH_URL = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  } else {
    env.NEXTAUTH_URL = 'http://localhost:3000';
  }
  changed = true;
  console.log(`  ✓ Set NEXTAUTH_URL to ${env.NEXTAUTH_URL}`);
}

// ── Persist .env.local ─────────────────────────────────────
// Only write managed keys, not the entire process.env
if (changed) {
  const lines = MANAGED_KEYS
    .filter((k) => env[k])
    .map((k) => `${k}=${env[k]}`)
    .join('\n');
  fs.writeFileSync(ENV_PATH, lines + '\n', { mode: 0o600 });
  console.log(`  ✓ Saved ${ENV_PATH}`);
}

// Set process.env so child commands inherit (managed keys only)
for (const k of MANAGED_KEYS) {
  if (env[k]) process.env[k] = env[k];
}

// Marker file: skip schema push + seed if they've already run cleanly
const MARKER = path.join(ROOT, '.setup-complete');
const skipDb = fs.existsSync(MARKER) && process.argv[2] !== '--force';
if (skipDb) {
  console.log('  ✓ Setup already complete (delete .setup-complete to re-run)');
  console.log('\n  Run `npm run dev` or `npm start` to launch.\n');
  process.exit(0);
}

// ── Push schema ────────────────────────────────────────────
console.log('\n→ Pushing database schema (drizzle-kit push)...');
try {
  execSync('npx drizzle-kit push --force', { stdio: 'inherit', cwd: ROOT, env: process.env });
} catch (e) {
  console.error('\n  ✗ Schema push failed.');
  console.error('     Check that DATABASE_URL points to a reachable Postgres database.\n');
  process.exit(1);
}

// ── Seed ───────────────────────────────────────────────────
console.log('\n→ Seeding database...');
try {
  execSync('npx tsx src/lib/db/seed.ts', { stdio: 'inherit', cwd: ROOT, env: process.env });
} catch (e) {
  console.error('\n  ✗ Seed failed.');
  process.exit(1);
}

// Write marker so subsequent boots skip setup
fs.writeFileSync(MARKER, new Date().toISOString() + '\n');

console.log('\n  ✓ Setup complete. Run `npm run dev` to start the app.\n');
