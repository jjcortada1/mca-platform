import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Lazy Postgres client. Works with any standard Postgres including:
 *   - Replit's built-in PostgreSQL
 *   - Neon (use the connection string from Neon dashboard)
 *   - Supabase, Railway, self-hosted, etc.
 *
 * Throws on first use, not on import — lets `next build` collect page data
 * without a live DATABASE_URL.
 */

type DBType = PostgresJsDatabase<typeof schema>;

let _sql: ReturnType<typeof postgres> | null = null;
let _db: DBType | null = null;

function getDb(): DBType {
  if (_db) return _db;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local or your deployment env.');
  }

  // Auto-handle SSL: required for Neon/Supabase/etc., not for local
  const url = process.env.DATABASE_URL;
  const needsSSL = !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('sslmode=disable');

  _sql = postgres(url, {
    ssl: needsSSL ? 'require' : false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // Better compatibility with PgBouncer/Neon
  });
  _db = drizzle(_sql, { schema });
  return _db;
}

/**
 * Proxy that forwards every property access to the real DB once initialized.
 */
export const db = new Proxy({} as DBType, {
  get(_target, prop) {
    const real = getDb();
    const val = (real as any)[prop];
    return typeof val === 'function' ? val.bind(real) : val;
  },
});

export type DB = DBType;

/**
 * Get the raw postgres client (for migrations, raw SQL, cleanup).
 */
export function getRawSql() {
  if (!_sql) getDb();
  return _sql!;
}
