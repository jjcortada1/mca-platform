'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace('channel_binding=require', 'channel_binding=disable'),
  ssl: { rejectUnauthorized: false },
});

const CREDIT_TIER_MAP = {
  'unknown':  0,
  '500_549':  500,
  '550_599':  550,
  '600_649':  600,
  '650_699':  650,
  '700_749':  700,
  '700_plus': 700,
};

function tierFromFunder(f) {
  const cr  = CREDIT_TIER_MAP[f.min_credit_tier] || 0;
  const pos = f.max_positions || 99;
  if (cr >= 650 && pos <= 1) return '1A';
  if (cr >= 600 && pos <= 1) return '1A';
  if (cr >= 600 && pos <= 3) return '1B';
  if (cr >= 550 && pos <= 3) return '2A';
  if (cr >= 500 && pos <= 5) return '2B';
  return '2B';
}

async function run() {
  const q = (sql, p = []) => {
    let i = 0;
    const pg = sql.replace(/\?/g, () => `$${++i}`);
    return pool.query(pg, p);
  };

  console.log('=== Starting migration ===');

  // ── Step 1: Rename old UUID tables ────────────────────────────────────────
  console.log('Renaming old tables...');
  for (const t of ['companies', 'users', 'funders', 'submission_funders']) {
    try {
      await pool.query(`DROP TABLE IF EXISTS ${t}_v1 CASCADE`);
      await pool.query(`ALTER TABLE ${t} RENAME TO ${t}_v1`);
      console.log(`  renamed ${t} → ${t}_v1`);
    } catch (e) {
      console.error(`  WARN: could not rename ${t}: ${e.message}`);
    }
  }

  // ── Step 2: Create fresh integer-ID tables ────────────────────────────────
  console.log('Creating new integer-ID tables...');

  await pool.query(`CREATE TABLE IF NOT EXISTS companies(
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'My Company',
    tagline TEXT DEFAULT '',
    color TEXT DEFAULT '#2563eb',
    logo_url TEXT DEFAULT '',
    master_email TEXT DEFAULT '',
    master_email_pass TEXT DEFAULT '',
    funder_mode TEXT DEFAULT 'master',
    rep_list TEXT DEFAULT '[]',
    auto_cc TEXT DEFAULT '',
    module_access TEXT DEFAULT '["dashboard","shop","dir","calc","submit","active","submissions","funded","uw","msg"]',
    rep_email_mode TEXT DEFAULT 'rep',
    info_sections TEXT DEFAULT NULL,
    industry_list TEXT DEFAULT NULL,
    shop_config TEXT DEFAULT NULL,
    email_signature TEXT DEFAULT '',
    commission_rate REAL DEFAULT 0,
    funded_email_config TEXT DEFAULT NULL,
    renewal_threshold REAL DEFAULT 0.50,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    display_name TEXT DEFAULT '',
    tab_access TEXT DEFAULT '[]',
    personal_email TEXT DEFAULT '',
    personal_email_pass TEXT DEFAULT '',
    email_signature TEXT DEFAULT '',
    commission_rate REAL DEFAULT 0,
    must_change_password INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS funders(
    id SERIAL PRIMARY KEY,
    company_id INTEGER,
    data TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS submission_funders(
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL,
    funder_name TEXT NOT NULL,
    tier TEXT DEFAULT '',
    emails_sent TEXT DEFAULT '[]',
    status TEXT DEFAULT 'No Response',
    notes TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW())`);

  console.log('  tables created');

  // ── Step 3: Migrate company ────────────────────────────────────────────────
  console.log('Migrating company...');
  const coRows = await pool.query('SELECT * FROM companies_v1 LIMIT 1');
  if (coRows.rows.length) {
    const co = coRows.rows[0];
    // primary_color is stored as HSL "215 75% 38%" — convert to a safe hex default
    const color = (co.primary_color || '').startsWith('#') ? co.primary_color : '#2563eb';
    const name  = co.name || co.display_name || 'Cortada Capital Group';
    await q(`INSERT INTO companies(id,name,tagline,color,logo_url,email_signature,
        commission_rate,funded_email_config,renewal_threshold,funder_mode)
      VALUES(1,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=EXCLUDED.name, color=EXCLUDED.color, logo_url=EXCLUDED.logo_url,
        email_signature=EXCLUDED.email_signature, commission_rate=EXCLUDED.commission_rate,
        funded_email_config=EXCLUDED.funded_email_config,
        renewal_threshold=EXCLUDED.renewal_threshold, funder_mode=EXCLUDED.funder_mode`,
      [name, '', color, co.logo_url || '', co.email_signature || '',
       co.commission_rate || 0,
       co.funded_email_config || null,
       co.renewal_threshold != null ? co.renewal_threshold : 0.50,
       co.funder_mode || 'master']);
    await pool.query(`SELECT setval(pg_get_serial_sequence('companies','id'), GREATEST(1,(SELECT MAX(id) FROM companies)))`);
    console.log(`  company "${name}" migrated (id=1)`);
  }

  // ── Step 4: Migrate users ──────────────────────────────────────────────────
  console.log('Migrating users...');
  const userRows = await pool.query('SELECT * FROM users_v1');
  const roleMap = {
    company_admin: 'admin',
    superadmin:    'superadmin',
    admin:         'admin',
    rep:           'user',
    lead_source:   'user',
    user:          'user',
    team_leader:   'team_leader',
  };

  const ALL_MODULES = '["dashboard","shop","dir","calc","submit","active","submissions","funded","uw","msg"]';

  // Sort: put admins first so they get lower IDs
  const sorted = [...userRows.rows].sort((a, b) => {
    const pri = r => ['company_admin','superadmin','admin'].includes(r.role) ? 0 : 1;
    return pri(a) - pri(b);
  });

  for (const u of sorted) {
    const newRole = roleMap[u.role] || 'user';
    const tabAccess = ['admin', 'superadmin'].includes(newRole) ? ALL_MODULES : '[]';
    // Preserve personal_email from smtp_config if present
    let personalEmail = '';
    if (u.smtp_config && u.smtp_config.user) personalEmail = u.smtp_config.user;
    try {
      await q(`INSERT INTO users(company_id,username,password,role,display_name,
          tab_access,personal_email,personal_email_pass,email_signature,commission_rate,must_change_password)
        VALUES(1,?,?,?,?,?,?,?,?,?,0)
        ON CONFLICT(username) DO UPDATE SET
          password=EXCLUDED.password, role=EXCLUDED.role,
          display_name=EXCLUDED.display_name, tab_access=EXCLUDED.tab_access,
          personal_email=EXCLUDED.personal_email,
          email_signature=EXCLUDED.email_signature,
          commission_rate=EXCLUDED.commission_rate`,
        [u.email, u.password_hash, newRole, u.name || u.email,
         tabAccess, personalEmail, '',
         u.email_signature || '', u.commission_rate || 0]);
      console.log(`  user "${u.email}" (${u.role} → ${newRole})`);
    } catch (e) {
      console.error(`  WARN user ${u.email}: ${e.message}`);
    }
  }
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST(1,(SELECT MAX(id) FROM users)))`);

  // ── Step 5: Migrate funders → JSON blob ───────────────────────────────────
  console.log('Migrating funders to JSON blob...');
  const funderRows = await pool.query('SELECT * FROM funders_v1 ORDER BY name');

  const funderBlob = funderRows.rows
    .filter(f => f.is_active !== false)
    .map(f => ({
      tier:     tierFromFunder(f),
      name:     f.name,
      emails:   Array.isArray(f.emails) ? f.emails : (f.emails ? [f.emails] : []),
      contacts: Array.isArray(f.phones) ? f.phones.map(p => typeof p === 'string' ? { n: '', p } : p) : [],
      maxPos:   f.max_positions || 99,
      minCr:    CREDIT_TIER_MAP[f.min_credit_tier] || 0,
      maxNSF:   99,
      minRev:   parseFloat(f.min_revenue) || 0,
      bad:      [],
      good:     [],
      badInd:   [],
      pref:     false,
      note:     f.notes || '',
    }));

  // Merge with funders.json to restore tier/NSF/bad-states data
  const fs   = require('fs');
  const path = require('path');
  const fjPath = path.join(__dirname, 'funders.json');
  if (fs.existsSync(fjPath)) {
    const canon = JSON.parse(fs.readFileSync(fjPath, 'utf8'));
    const canonMap = {};
    canon.forEach(c => { canonMap[c.name.trim().toLowerCase()] = c; });
    for (const f of funderBlob) {
      const key = f.name.trim().toLowerCase();
      const c   = canonMap[key];
      if (c) {
        f.tier   = c.tier || f.tier;
        f.maxNSF = c.maxNSF != null ? c.maxNSF : f.maxNSF;
        f.bad    = c.bad || [];
        f.good   = c.good || [];
        f.badInd = c.badInd || [];
        f.pref   = c.pref || false;
        // Keep DB emails if set, otherwise use canon
        if (!f.emails.length && c.emails) f.emails = c.emails;
        if (!f.contacts.length && c.contacts) f.contacts = c.contacts;
      }
    }
    console.log(`  merged ${funderBlob.length} funders with funders.json`);
  }

  await q(`INSERT INTO funders(company_id, data) VALUES(NULL, ?)`, [JSON.stringify(funderBlob)]);
  console.log(`  inserted master funder blob (${funderBlob.length} funders, company_id=NULL)`);
  await pool.query(`SELECT setval(pg_get_serial_sequence('funders','id'), GREATEST(1,(SELECT MAX(id) FROM funders)))`);

  // ── Step 6: Migrate submission_funders (best-effort) ──────────────────────
  // submission_id was UUID referencing a UUID-based submissions table that was
  // already migrated to integer IDs; the UUID↔integer mapping no longer exists.
  // We preserve funder_name, status, and notes with submission_id=0 so the
  // records aren't lost. Admins can reassign them if needed.
  console.log('Migrating submission_funders (best-effort)...');
  const sfRows = await pool.query(`
    SELECT sf.*, f.name AS funder_name_resolved
    FROM submission_funders_v1 sf
    LEFT JOIN funders_v1 f ON sf.funder_id = f.id`);

  let sfCount = 0;
  for (const sf of sfRows.rows) {
    const fname  = sf.funder_name_resolved || sf.manual_funder_name || 'Unknown';
    const status = sf.status ? sf.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'No Response';
    try {
      await q(`INSERT INTO submission_funders(submission_id,funder_name,tier,emails_sent,status,notes,updated_at)
               VALUES(0,?,?,?,?,?,?)`,
        [fname, '', '[]', status, sf.notes || '', sf.submitted_at || new Date()]);
      sfCount++;
    } catch (e) {
      console.error(`  WARN sf: ${e.message}`);
    }
  }
  await pool.query(`SELECT setval(pg_get_serial_sequence('submission_funders','id'), GREATEST(1,(SELECT MAX(id) FROM submission_funders)))`);
  console.log(`  migrated ${sfCount} submission_funder records (submission_id=0 placeholder)`);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n=== Migration complete ===');
  console.log('Old tables preserved as: companies_v1, users_v1, funders_v1, submission_funders_v1');
  console.log('Login with your existing email/password (passwords unchanged).');
  await pool.end();
}

run().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
