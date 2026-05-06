import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const url = process.env.DATABASE_URL;
  const needsSSL = !url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('sslmode=disable');
  const sql = postgres(url, { ssl: needsSSL ? 'require' : false, max: 1 });
  const db = drizzle(sql);
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations complete.');
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
