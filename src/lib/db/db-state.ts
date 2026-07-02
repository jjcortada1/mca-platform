/**
 * Prints whether the database already has the core schema.
 *
 * Used by scripts/setup.js to decide — SAFELY — whether first-time setup
 * (schema push + seed) may run. It prints exactly one word:
 *
 *   FRESH   → the `companies` table does not exist yet (brand-new empty DB).
 *             First-time setup is allowed to create the schema and seed.
 *   EXISTS  → the schema is already there (a real database with data).
 *             Setup must NOT push/seed — doing so risks wiping data.
 *
 * On ANY error we print EXISTS (fail safe): when in doubt, never run the
 * destructive first-time path against a database we couldn't inspect.
 */
import { getRawSql } from './client';

async function main() {
  try {
    const sql = getRawSql();
    const rows = await sql`SELECT to_regclass('public.companies') AS t`;
    const exists = rows?.[0]?.t != null;
    // eslint-disable-next-line no-console
    console.log(exists ? 'EXISTS' : 'FRESH');
  } catch {
    // eslint-disable-next-line no-console
    console.log('EXISTS');
  }
  process.exit(0);
}

main();
