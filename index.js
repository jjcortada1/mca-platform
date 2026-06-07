'use strict';
const express    = require('express');
const session    = require('express-session');
const bcrypt     = require('bcryptjs');
const { Pool }   = require('pg');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL||'').replace('channel_binding=require','channel_binding=disable'),
  ssl: { rejectUnauthorized: false },
  max: 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
});
pool.on('error', e => console.error('Pool error:', e.message));

const db = {
  async run(sql, p=[]) {
    let i=0; const pg=sql.replace(/\?/g,()=>`$${++i}`);
    const r=await pool.query(pg,p);
    return {lastID:r.rows[0]?.id??null,changes:r.rowCount,rows:r.rows};
  },
  async get(sql,p=[]) { const r=await this.run(sql,p); return r.rows[0]||null; },
  async all(sql,p=[]) { const r=await this.run(sql,p); return r.rows; },
};

const app = express();
app.set('trust proxy',1);

const CANDIDATES=[__dirname,process.cwd(),'/app','/home/runner/workspace'];
let ROOT=__dirname;
for(const c of CANDIDATES){try{if(fs.existsSync(path.join(c,'index.html'))){ROOT=c;break;}}catch(e){}}

const ALL_MODULES=['dashboard','shop','dir','calc','submit','active','submissions','funded','board','uw','msg'];

app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({extended:true,limit:'50mb'}));
app.use((req,res,next)=>{
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if(process.env.NODE_ENV==='production'&&req.headers['x-forwarded-proto']==='http')
    return res.redirect(301,'https://'+req.headers.host+req.url);
  next();
});
app.use(express.static(ROOT));

const SESSION_SECRET=process.env.SESSION_SECRET||crypto.randomBytes(64).toString('hex');
app.use(session({
  secret:SESSION_SECRET,resave:false,saveUninitialized:false,name:'sid',
  cookie:{maxAge:8*60*60*1000,httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax'},
}));

const loginAttempts=new Map();
function checkRateLimit(ip){
  const now=Date.now(),W=15*60*1000,MAX=10;
  const e=loginAttempts.get(ip)||{n:0,t:now,block:0};
  if(e.block&&now<e.block)return false;
  if(now-e.t>W){loginAttempts.set(ip,{n:1,t:now,block:0});return true;}
  e.n++;
  if(e.n>MAX){e.block=now+W;loginAttempts.set(ip,e);return false;}
  loginAttempts.set(ip,e);return true;
}

const auth      =(req,res,next)=>req.session.user?next():res.status(401).json({error:'Not authenticated'});
const adminOnly =(req,res,next)=>['admin','superadmin'].includes(req.session.user?.role)?next():res.status(403).json({error:'Forbidden'});
const superOnly =(req,res,next)=>req.session.user?.role==='superadmin'?next():res.status(403).json({error:'Forbidden'});

async function initDb(){
  await db.run(`CREATE TABLE IF NOT EXISTS companies(
    id SERIAL PRIMARY KEY,name TEXT NOT NULL DEFAULT 'My Company',
    tagline TEXT DEFAULT '',color TEXT DEFAULT '#2563eb',logo_url TEXT DEFAULT '',
    master_email TEXT DEFAULT '',master_email_pass TEXT DEFAULT '',
    funder_mode TEXT DEFAULT 'master',rep_list TEXT DEFAULT '[]',
    auto_cc TEXT DEFAULT '',
    module_access TEXT DEFAULT '["dashboard","shop","dir","calc","submit","active","submissions","funded","uw","msg"]',
    rep_email_mode TEXT DEFAULT 'rep',info_sections TEXT DEFAULT NULL,
    industry_list TEXT DEFAULT NULL,shop_config TEXT DEFAULT NULL,
    email_signature TEXT DEFAULT '',commission_rate REAL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  await db.run(`CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY,company_id INTEGER NOT NULL,
    username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,
    role TEXT DEFAULT 'user',display_name TEXT DEFAULT '',
    tab_access TEXT DEFAULT '[]',personal_email TEXT DEFAULT '',
    personal_email_pass TEXT DEFAULT '',email_signature TEXT DEFAULT '',
    commission_rate REAL DEFAULT 0,must_change_password INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  await db.run(`CREATE TABLE IF NOT EXISTS teams(
    id SERIAL PRIMARY KEY,company_id INTEGER NOT NULL,
    name TEXT NOT NULL,leader_name TEXT DEFAULT '',
    member_names TEXT DEFAULT '[]',created_at TIMESTAMPTZ DEFAULT NOW())`);

  await db.run(`CREATE TABLE IF NOT EXISTS funders(
    id SERIAL PRIMARY KEY,company_id INTEGER,
    data TEXT NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW())`);

  await db.run(`CREATE TABLE IF NOT EXISTS active_deals(
    id SERIAL PRIMARY KEY,company_id INTEGER NOT NULL,
    deal_name TEXT NOT NULL,first_name TEXT DEFAULT '',last_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',email TEXT DEFAULT '',rep TEXT DEFAULT '',
    deal_date TEXT DEFAULT '',notes TEXT DEFAULT '',offers TEXT DEFAULT '[]',
    status TEXT DEFAULT 'New',created_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW())`);

  await db.run(`CREATE TABLE IF NOT EXISTS deal_submissions(
    id SERIAL PRIMARY KEY,company_id INTEGER NOT NULL,
    deal_name TEXT NOT NULL,deal_id INTEGER,
    submitted_by TEXT NOT NULL,submitted_by_id INTEGER,
    funders_sent TEXT DEFAULT '[]',notes TEXT DEFAULT '',
    is_manual INTEGER DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW())`);

  await db.run(`CREATE TABLE IF NOT EXISTS submission_funders(
    id SERIAL PRIMARY KEY,submission_id INTEGER NOT NULL,
    funder_name TEXT NOT NULL,tier TEXT DEFAULT '',
    emails_sent TEXT DEFAULT '[]',status TEXT DEFAULT 'No Response',
    notes TEXT DEFAULT '',updated_at TIMESTAMPTZ DEFAULT NOW())`);

  await db.run(`CREATE TABLE IF NOT EXISTS funded_board(
    id SERIAL PRIMARY KEY,company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,username TEXT NOT NULL,display_name TEXT DEFAULT '',
    amount REAL NOT NULL,commission REAL DEFAULT 0,
    funder_name TEXT NOT NULL,notes TEXT DEFAULT '',
    custom_fields TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW())`);

  const migrations=[
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS funder_mode TEXT DEFAULT 'master'`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT ''`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS commission_rate REAL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_rate REAL DEFAULT 0`,
    `ALTER TABLE funded_board ADD COLUMN IF NOT EXISTS commission REAL DEFAULT 0`,
    `ALTER TABLE funded_board ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`,
    `ALTER TABLE funded_board ADD COLUMN IF NOT EXISTS deal_name TEXT DEFAULT ''`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS funded_email_config TEXT DEFAULT NULL`,
    `ALTER TABLE funded_board ADD COLUMN IF NOT EXISTS custom_fields TEXT DEFAULT '{}'`,
    `UPDATE companies SET module_access=REPLACE(module_access,']',',"uw"]') WHERE module_access NOT LIKE '%uw%' AND module_access IS NOT NULL`,
    `UPDATE companies SET module_access=REPLACE(module_access,']',',"dashboard"]') WHERE module_access NOT LIKE '%dashboard%' AND module_access IS NOT NULL`,
    // Add the new Funded Deals tab to companies that pre-date this feature.
    // The replace appends "funded" inside the existing JSON array; the NOT LIKE
    // guard prevents double-inserting if this migration ever runs again.
    `UPDATE companies SET module_access=REPLACE(module_access,']',',"funded"]') WHERE module_access NOT LIKE '%funded%' AND module_access IS NOT NULL`,
    // Same for any user whose tab_access was explicitly snapshotted.
    `UPDATE users SET tab_access=REPLACE(tab_access,']',',"funded"]') WHERE tab_access NOT LIKE '%funded%' AND tab_access IS NOT NULL AND tab_access != '[]'`,
    // Phase 2: funding details for the Funded Deals tab. Stored as a JSON
    // blob to keep schema additions minimal and so future paydown-tracker
    // fields can be added without further migrations. Contains: funder,
    // funded_date, funded_amount, factor_rate, term, term_unit,
    // payment_frequency, scheduled_payment, fees, notes. NULL means the
    // user hasn't entered funding details yet (or the deal isn't Funded).
    `ALTER TABLE active_deals ADD COLUMN IF NOT EXISTS funded_details TEXT DEFAULT NULL`,
    // Phase 3: per-deal shopping criteria (revenue, credit, nsfs, position,
    // state, industry, reverse flag). Stored as JSON so shop criteria persist
    // with the deal — when a rep re-shops the same deal next week the form
    // is pre-filled with last week's profile, and notes carry over too.
    `ALTER TABLE active_deals ADD COLUMN IF NOT EXISTS criteria TEXT DEFAULT NULL`,
    // Phase 6: retire the legacy per-rep "Funded Board" tab. Strip 'board'
    // from existing companies' module_access. The renderFundedBoard function
    // is left in the client code so any admin who explicitly re-adds it via
    // module_access still gets a working tab — this just removes it from the
    // default set so it doesn't show up in everyone's sidebar. Three REPLACE
    // calls cover every position 'board' might appear in the JSON array.
    `UPDATE companies SET module_access=REPLACE(module_access,',"board"','') WHERE module_access LIKE '%"board"%'`,
    `UPDATE companies SET module_access=REPLACE(module_access,'"board",','') WHERE module_access LIKE '%"board"%'`,
    `UPDATE companies SET module_access=REPLACE(module_access,'"board"','') WHERE module_access LIKE '%"board"%'`,
    // Same for any user whose tab_access was explicitly snapshotted with board.
    `UPDATE users SET tab_access=REPLACE(tab_access,',"board"','') WHERE tab_access LIKE '%"board"%'`,
    `UPDATE users SET tab_access=REPLACE(tab_access,'"board",','') WHERE tab_access LIKE '%"board"%'`,
    `UPDATE users SET tab_access=REPLACE(tab_access,'"board"','') WHERE tab_access LIKE '%"board"%'`,
    // Phase 6: configurable renewal threshold per company. Stored as a
    // decimal (e.g. 0.50 = 50%) so admins can match their internal renewal
    // policy. Default 0.50 — same as the previously-hardcoded value, so
    // existing behavior is preserved on upgrade.
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS renewal_threshold REAL DEFAULT 0.50`,
  ];
  for(const sql of migrations){try{await pool.query(sql);}catch(e){}}

  const co=await db.get(`SELECT id FROM companies WHERE id=1`);
  if(!co){
    try{await pool.query(`INSERT INTO companies(id,name,tagline,color)VALUES(1,'Admin','Deal Management','#2563eb')ON CONFLICT(id)DO NOTHING`);}catch(e){}
    try{await pool.query(`SELECT setval(pg_get_serial_sequence('companies','id'),GREATEST(1,(SELECT MAX(id)FROM companies)))`);}catch(e){}
  }

  try{
    const hash=bcrypt.hashSync('Admin1!',10);
    const ex=await db.get(`SELECT id FROM users WHERE LOWER(username)IN('admin','jj','jj@cortadacapitalgroup.com')ORDER BY id LIMIT 1`);
    if(ex){
      await pool.query(`UPDATE users SET username=$1,password=$2,role=$3,display_name=$4,tab_access=$5,must_change_password=0 WHERE id=$6`,
        ['admin',hash,'superadmin','Admin',JSON.stringify(ALL_MODULES),ex.id]);
      console.log('Superadmin updated id:',ex.id);
    }else{
      const r=await pool.query(`INSERT INTO users(company_id,username,password,role,display_name,tab_access,must_change_password)VALUES(1,$1,$2,$3,$4,$5,0)RETURNING id`,
        ['admin',hash,'superadmin','Admin',JSON.stringify(ALL_MODULES)]);
      console.log('Superadmin created id:',r.rows[0]?.id);
    }
  }catch(e){console.error('Superadmin seed error:',e.message);}

  try{
    const fjPath=[path.join(ROOT,'funders.json'),path.join(__dirname,'funders.json')].find(p=>fs.existsSync(p));
    if(fjPath){
      const data=fs.readFileSync(fjPath,'utf8');
      const canon=JSON.parse(data);
      const fmap={};canon.forEach(f=>{fmap[f.name.trim().toLowerCase()]={emails:f.emails,contacts:f.contacts};});
      const mf=await db.get(`SELECT id,data FROM funders WHERE company_id IS NULL ORDER BY id DESC LIMIT 1`);
      if(!mf){await db.run(`INSERT INTO funders(company_id,data)VALUES(NULL,?)`,[data]);console.log('Funders seeded');}
      else{
        let arr=JSON.parse(mf.data);
        arr=arr.map(f=>{const s=fmap[(f.name||'').trim().toLowerCase()];return s?{...f,...s}:f;});
        await db.run(`UPDATE funders SET data=?,updated_at=NOW() WHERE company_id IS NULL`,[JSON.stringify(arr)]);
        console.log('Funders synced');
      }
      const rows=await db.all(`SELECT id,data FROM funders WHERE company_id IS NOT NULL`);
      for(const row of rows){
        try{
          let arr=JSON.parse(row.data);
          arr=arr.map(f=>{const s=fmap[(f.name||'').trim().toLowerCase()];return s?{...f,...s}:f;});
          await db.run(`UPDATE funders SET data=?,updated_at=NOW() WHERE id=?`,[JSON.stringify(arr),row.id]);
        }catch(e){}
      }
    }
  }catch(e){console.error('Funders sync error:',e.message);}
}

async function getFunders(cid){
  try{
    const co=await db.get(`SELECT funder_mode FROM companies WHERE id=?`,[cid]);
    const useMaster=!co||co.funder_mode!=='custom';
    const row=useMaster
      ?await db.get(`SELECT data FROM funders WHERE company_id IS NULL ORDER BY id DESC LIMIT 1`)
      :await db.get(`SELECT data FROM funders WHERE company_id=? ORDER BY id DESC LIMIT 1`,[cid]);
    let funders=row?JSON.parse(row.data):[];
    try{
      const fjPath=[path.join(ROOT,'funders.json'),path.join(__dirname,'funders.json')].find(p=>fs.existsSync(p));
      if(fjPath){
        const canon=JSON.parse(fs.readFileSync(fjPath,'utf8'));
        const fmap={};canon.forEach(f=>{fmap[f.name.trim().toLowerCase()]={emails:f.emails,contacts:f.contacts};});
        funders=funders.map(f=>{const s=fmap[(f.name||'').trim().toLowerCase()];return s?{...f,emails:s.emails,contacts:s.contacts}:f;});
      }
    }catch(e){}
    return Array.isArray(funders)?funders:[];
  }catch(e){console.error('getFunders:',e.message);return[];}
}

async function saveFunders(cid,funders){
  const co=await db.get(`SELECT funder_mode FROM companies WHERE id=?`,[cid]);
  const useMaster=!co||co.funder_mode!=='custom';
  if(useMaster){await db.run(`UPDATE funders SET data=?,updated_at=NOW() WHERE company_id IS NULL`,[JSON.stringify(funders)]);}
  else{
    const ex=await db.get(`SELECT id FROM funders WHERE company_id=?`,[cid]);
    if(ex)await db.run(`UPDATE funders SET data=?,updated_at=NOW() WHERE company_id=?`,[JSON.stringify(funders),cid]);
    else await db.run(`INSERT INTO funders(company_id,data)VALUES(?,?)`,[cid,JSON.stringify(funders)]);
  }
}

async function getVisFilter(uid,role,cid){
  if(['admin','superadmin'].includes(role))return null;
  const u=await db.get(`SELECT * FROM users WHERE id=?`,[uid]);
  const myName=u?.display_name||u?.username||'';
  const teams=await db.all(`SELECT * FROM teams WHERE company_id=?`,[cid]);
  const myTeam=teams.find(t=>t.leader_name===myName||JSON.parse(t.member_names||'[]').includes(myName));
  if(role==='team_leader'||myTeam){
    const members=myTeam?JSON.parse(myTeam.member_names||'[]'):[];
    return{names:[myName,...members]};
  }
  return{uid};
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/login',async(req,res)=>{
  try{
    const ip=req.headers['x-forwarded-for']?.split(',')[0]||req.socket.remoteAddress||'?';
    if(!checkRateLimit(ip))return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
    const{username,password}=req.body;
    if(!username||!password)return res.status(400).json({error:'Username and password required'});
    const u=await db.get(`SELECT * FROM users WHERE LOWER(username)=?`,[username.trim().toLowerCase()]);
    if(!u||!bcrypt.compareSync(password,u.password))return res.status(401).json({error:'Invalid username or password'});
    const co=await db.get(`SELECT * FROM companies WHERE id=?`,[u.company_id]);
    const tabs=['admin','superadmin'].includes(u.role)?ALL_MODULES:JSON.parse(u.tab_access||'[]');
    req.session.regenerate(err=>{
      if(err)return res.status(500).json({error:'Session error'});
      req.session.user={id:u.id,username:u.username,role:u.role,company_id:u.company_id,display_name:u.display_name||u.username,tabs};
      res.json({ok:true,user:req.session.user,company:co,must_change_password:u.must_change_password===1});
    });
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/logout',(req,res)=>{req.session.destroy();res.json({ok:true});});
app.get('/api/me',async(req,res)=>{
  try{
    if(!req.session.user)return res.json({user:null});
    const u=await db.get(`SELECT * FROM users WHERE id=?`,[req.session.user.id]);
    if(!u)return res.json({user:null});
    const co=await db.get(`SELECT * FROM companies WHERE id=?`,[u.company_id]);
    const tabs=['admin','superadmin'].includes(u.role)?ALL_MODULES:JSON.parse(u.tab_access||'[]');
    req.session.user.tabs=tabs;
    res.json({user:{...req.session.user,tabs},company:co});
  }catch(e){res.json({user:null});}
});

// ── Company ───────────────────────────────────────────────────────────────────
app.get('/api/company',auth,async(req,res)=>{
  try{
    const co=await db.get(`SELECT * FROM companies WHERE id=?`,[req.session.user.company_id]);
    if(req.session.user.role!=='superadmin')delete co.master_email_pass;
    res.json(co);
  }catch(e){res.status(500).json({error:e.message});}
});
app.put('/api/company',adminOnly,async(req,res)=>{
  try{
    const cid=req.session.user.company_id;
    const co=await db.get(`SELECT * FROM companies WHERE id=?`,[cid]);
    const{name,tagline,color,logo_url,master_email,master_email_pass,rep_list,info_sections,auto_cc,module_access,rep_email_mode,industry_list,shop_config,email_signature,funder_mode,commission_rate,funded_email_config,renewal_threshold}=req.body;
    // Clamp renewal_threshold to [0,1] so a typo can't store -5 or 50000
    // and break paydown math. NULL/undefined preserves the existing value.
    let nextThreshold=co.renewal_threshold;
    if(renewal_threshold!==undefined&&renewal_threshold!==null){
      const v=parseFloat(renewal_threshold);
      if(isFinite(v))nextThreshold=Math.max(0,Math.min(1,v));
    }
    await db.run(`UPDATE companies SET name=?,tagline=?,color=?,logo_url=?,master_email=?,master_email_pass=?,rep_list=?,info_sections=?,auto_cc=?,module_access=?,rep_email_mode=?,industry_list=?,shop_config=?,email_signature=?,funder_mode=?,commission_rate=?,funded_email_config=?,renewal_threshold=? WHERE id=?`,
      [name??co.name,tagline??co.tagline,color??co.color,logo_url??co.logo_url,master_email??co.master_email,
       master_email_pass!==undefined?master_email_pass:co.master_email_pass,
       rep_list??co.rep_list,info_sections!==undefined?info_sections:co.info_sections,
       auto_cc!==undefined?auto_cc:co.auto_cc,module_access!==undefined?module_access:co.module_access,
       rep_email_mode??co.rep_email_mode,industry_list!==undefined?industry_list:co.industry_list,
       shop_config!==undefined?shop_config:co.shop_config,email_signature!==undefined?email_signature:co.email_signature,
       funder_mode??co.funder_mode,commission_rate!==undefined?commission_rate:co.commission_rate,funded_email_config!==undefined?funded_email_config:co.funded_email_config,nextThreshold,cid]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Users ─────────────────────────────────────────────────────────────────────
app.get('/api/users',adminOnly,async(req,res)=>{
  try{res.json(await db.all(`SELECT id,username,display_name,role,tab_access,personal_email,commission_rate,created_at FROM users WHERE company_id=? ORDER BY created_at`,[req.session.user.company_id]));}
  catch(e){res.status(500).json({error:e.message});}
});
// Lightweight team directory — name + email only, available to any authenticated
// user. Used by Submit so a rep can CC their teammate by picking them from a
// dropdown without needing admin access. No passwords, no roles — strictly the
// minimum needed for the "auto-CC the assigned rep" feature.
app.get('/api/team',auth,async(req,res)=>{
  try{
    const rows=await db.all(
      `SELECT display_name, username, personal_email FROM users WHERE company_id=? AND personal_email IS NOT NULL AND personal_email != '' ORDER BY display_name`,
      [req.session.user.company_id]
    );
    res.json(rows);
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/users/profile',auth,async(req,res)=>{
  try{res.json(await db.get(`SELECT id,username,display_name,personal_email,personal_email_pass,email_signature,commission_rate FROM users WHERE id=?`,[req.session.user.id]));}
  catch(e){res.status(500).json({error:e.message});}
});
app.put('/api/users/profile',auth,async(req,res)=>{
  try{
    const{display_name,personal_email,personal_email_pass,password,email_signature}=req.body;
    const u=await db.get(`SELECT * FROM users WHERE id=?`,[req.session.user.id]);
    if(password)await db.run(`UPDATE users SET password=?,must_change_password=0 WHERE id=?`,[bcrypt.hashSync(password,10),req.session.user.id]);
    await db.run(`UPDATE users SET display_name=?,personal_email=?,personal_email_pass=?,email_signature=? WHERE id=?`,
      [display_name??u.display_name,personal_email??u.personal_email,
       personal_email_pass!==undefined?personal_email_pass:u.personal_email_pass,
       email_signature!==undefined?email_signature:u.email_signature,req.session.user.id]);
    req.session.user.display_name=display_name??u.display_name;
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/users/test-email',auth,async(req,res)=>{
  try{
    const{email,password}=req.body;
    if(!email||!password)return res.status(400).json({error:'Required'});
    const t=nodemailer.createTransport({service:'gmail',auth:{user:email,pass:password}});
    await t.verify();res.json({ok:true});
  }catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/users',adminOnly,async(req,res)=>{
  try{
    const{username,password,role,display_name,commission_rate}=req.body;
    if(!username||!password)return res.status(400).json({error:'Username and password required'});
    await db.run(`INSERT INTO users(company_id,username,password,role,display_name,tab_access,commission_rate,must_change_password)VALUES(?,?,?,?,?,'[]',?,1)`,
      [req.session.user.company_id,username,bcrypt.hashSync(password,10),role||'user',display_name||username,commission_rate||0]);
    res.json({ok:true});
  }catch(e){res.status(400).json({error:'Username already exists'});}
});
app.put('/api/users/:id',adminOnly,async(req,res)=>{
  try{
    const u=await db.get(`SELECT * FROM users WHERE id=? AND company_id=?`,[req.params.id,req.session.user.company_id]);
    if(!u)return res.status(404).json({error:'Not found'});
    const{display_name,role,tab_access,password,personal_email,personal_email_pass,commission_rate}=req.body;
    if(password)await db.run(`UPDATE users SET password=?,must_change_password=0 WHERE id=?`,[bcrypt.hashSync(password,10),req.params.id]);
    await db.run(`UPDATE users SET display_name=?,role=?,tab_access=?,personal_email=?,personal_email_pass=?,commission_rate=? WHERE id=? AND company_id=?`,
      [display_name??u.display_name,role??u.role,tab_access??u.tab_access,
       personal_email!==undefined?personal_email:u.personal_email,
       personal_email_pass!==undefined?personal_email_pass:u.personal_email_pass,
       commission_rate!==undefined?commission_rate:u.commission_rate,
       req.params.id,req.session.user.company_id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/users/:id',adminOnly,async(req,res)=>{
  try{
    const u=await db.get(`SELECT * FROM users WHERE id=? AND company_id=?`,[req.params.id,req.session.user.company_id]);
    if(!u)return res.status(404).json({error:'Not found'});
    if(u.role==='superadmin')return res.status(403).json({error:'Cannot delete superadmin'});
    await db.run(`DELETE FROM users WHERE id=?`,[req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Teams ─────────────────────────────────────────────────────────────────────
app.get('/api/teams',auth,async(req,res)=>{
  try{
    const teams=await db.all(`SELECT * FROM teams WHERE company_id=?`,[req.session.user.company_id]);
    res.json(teams.map(t=>({...t,member_names:JSON.parse(t.member_names||'[]')})));
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/teams',adminOnly,async(req,res)=>{
  try{
    const{name,leader_name,member_names}=req.body;
    if(!name)return res.status(400).json({error:'Name required'});
    const r=await db.get(`INSERT INTO teams(company_id,name,leader_name,member_names)VALUES(?,?,?,?)RETURNING id`,
      [req.session.user.company_id,name,leader_name||'',JSON.stringify(member_names||[])]);
    res.json({ok:true,id:r.id});
  }catch(e){res.status(500).json({error:e.message});}
});
app.put('/api/teams/:id',adminOnly,async(req,res)=>{
  try{
    const{name,leader_name,member_names}=req.body;
    await db.run(`UPDATE teams SET name=?,leader_name=?,member_names=? WHERE id=? AND company_id=?`,
      [name,leader_name||'',JSON.stringify(member_names||[]),req.params.id,req.session.user.company_id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/teams/:id',adminOnly,async(req,res)=>{
  try{await db.run(`DELETE FROM teams WHERE id=? AND company_id=?`,[req.params.id,req.session.user.company_id]);res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message});}
});

// ── Funders ───────────────────────────────────────────────────────────────────
app.get('/api/funders',auth,async(req,res)=>{
  try{res.json(await getFunders(req.session.user.company_id));}
  catch(e){res.json([]);}
});
app.put('/api/funders/:index',adminOnly,async(req,res)=>{
  try{
    const idx=parseInt(req.params.index);const f=await getFunders(req.session.user.company_id);
    if(idx<0||idx>=f.length)return res.status(404).json({error:'Not found'});
    f[idx]={...f[idx],...req.body};await saveFunders(req.session.user.company_id,f);res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/funders',adminOnly,async(req,res)=>{
  try{const f=await getFunders(req.session.user.company_id);f.push(req.body);await saveFunders(req.session.user.company_id,f);res.json({ok:true,index:f.length-1});}
  catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/funders/:index',adminOnly,async(req,res)=>{
  try{
    const idx=parseInt(req.params.index);const f=await getFunders(req.session.user.company_id);
    f.splice(idx,1);await saveFunders(req.session.user.company_id,f);res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/funders/upload-contacts',superOnly,async(req,res)=>{
  try{
    const{csv}=req.body;if(!csv)return res.status(400).json({error:'No data'});
    const lines=csv.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<2)return res.status(400).json({error:'Need header + data rows'});
    const headers=lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/[^a-z0-9]/g,''));
    const nI=headers.findIndex(h=>h.includes('name'));
    const eI=headers.findIndex(h=>h.includes('email'));
    const pI=headers.findIndex(h=>h.includes('phone'));
    const cI=headers.findIndex(h=>h.includes('contact')||h.includes('rep'));
    if(nI===-1)return res.status(400).json({error:'CSV needs Name column'});
    const updates={};
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(',').map(c=>c.replace(/^"|"$/g,'').trim());
      const name=cols[nI];if(!name)continue;
      updates[name.trim().toLowerCase()]={
        emails:eI!==-1&&cols[eI]?cols[eI].split(/[;|]/).map(e=>e.trim()).filter(Boolean):undefined,
        phone:pI!==-1?cols[pI]:undefined,contact:cI!==-1?cols[cI]:undefined,
      };
    }
    const rows=await db.all(`SELECT id,data FROM funders`);let total=0;
    for(const row of rows){
      let arr=JSON.parse(row.data);let changed=false;
      arr=arr.map(f=>{
        const src=updates[(f.name||'').trim().toLowerCase()];if(!src)return f;
        changed=true;const nf={...f};
        if(src.emails)nf.emails=src.emails;
        if(src.phone||src.contact)nf.contacts=[{n:src.contact||'',p:src.phone||''}];
        return nf;
      });
      if(changed){await db.run(`UPDATE funders SET data=?,updated_at=NOW() WHERE id=?`,[JSON.stringify(arr),row.id]);total++;}
    }
    res.json({ok:true,matched:Object.keys(updates).length,rowsUpdated:total});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Active Deals ──────────────────────────────────────────────────────────────
app.get('/api/active-deals',auth,async(req,res)=>{
  try{
    const{id:uid,role,company_id:cid}=req.session.user;
    const filter=await getVisFilter(uid,role,cid);
    let deals;
    if(!filter){deals=await db.all(`SELECT * FROM active_deals WHERE company_id=? ORDER BY updated_at DESC`,[cid]);}
    else if(filter.names){
      const ph=filter.names.map(()=>'?').join(',');
      deals=await db.all(`SELECT * FROM active_deals WHERE company_id=? AND rep IN(${ph})ORDER BY updated_at DESC`,[cid,...filter.names]);
    }else{deals=await db.all(`SELECT * FROM active_deals WHERE company_id=? AND created_by=? ORDER BY updated_at DESC`,[cid,uid]);}
    // Parse JSON blobs server-side so the client doesn't have to. `offers` is
    // a list of offer objects; `funded_details` is the per-deal funding info
    // (only populated for Funded deals). Both default to safe shapes.
    res.json(deals.map(d=>({
      ...d,
      offers:JSON.parse(d.offers||'[]'),
      funded_details:d.funded_details?(()=>{try{return JSON.parse(d.funded_details);}catch(e){return null;}})():null,
      // Phase 3: per-deal shopping criteria (revenue/credit/NSF/position/state/industry/rev).
      criteria:d.criteria?(()=>{try{return JSON.parse(d.criteria);}catch(e){return null;}})():null,
    })));
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/active-deals',auth,async(req,res)=>{
  try{
    const{deal_name,first_name,last_name,phone,email,rep,deal_date,notes,offers,status,funded_details,criteria}=req.body;
    if(!deal_name)return res.status(400).json({error:'Deal name required'});
    // If created directly as Funded with no funding_details supplied, leave
    // the column NULL; client can edit on Funded Deals tab later.
    const fd=funded_details?JSON.stringify(funded_details):null;
    const cr=criteria?JSON.stringify(criteria):null;
    const r=await db.get(`INSERT INTO active_deals(company_id,deal_name,first_name,last_name,phone,email,rep,deal_date,notes,offers,status,created_by,funded_details,criteria)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)RETURNING id`,
      [req.session.user.company_id,deal_name,first_name||'',last_name||'',phone||'',email||'',rep||'',deal_date||'',notes||'',JSON.stringify(offers||[]),status||'New',req.session.user.id,fd,cr]);
    res.json({ok:true,id:r.id});
  }catch(e){res.status(500).json({error:e.message});}
});
app.put('/api/active-deals/:id',auth,async(req,res)=>{
  try{
    const d=await db.get(`SELECT * FROM active_deals WHERE id=? AND company_id=?`,[req.params.id,req.session.user.company_id]);
    if(!d)return res.status(404).json({error:'Not found'});
    const canEdit=['admin','superadmin'].includes(req.session.user.role)||d.created_by===req.session.user.id;
    if(!canEdit)return res.status(403).json({error:'Forbidden'});
    const{deal_name,first_name,last_name,phone,email,rep,deal_date,notes,offers,status,funded_details,criteria}=req.body;
    const newStatus=status??d.status;
    const oldStatus=d.status;
    // Auto-populate funded_details from the accepted offer when a deal first
    // transitions to Funded. If the client didn't send funded_details and
    // the existing column is NULL and there's an accepted offer, seed it
    // automatically so reps don't have to re-type the funding numbers.
    let nextFundedDetails;
    if(funded_details!==undefined){
      nextFundedDetails=funded_details?JSON.stringify(funded_details):null;
    } else if(oldStatus!=='Funded'&&newStatus==='Funded'&&!d.funded_details){
      const offerList=offers||JSON.parse(d.offers||'[]');
      const accepted=offerList.find(o=>o&&o.accepted);
      if(accepted){
        nextFundedDetails=JSON.stringify({
          funder:accepted.funder||'',
          funded_amount:accepted.funding_amount||accepted.amount||'',
          factor_rate:accepted.factor_rate||'',
          term:accepted.term||'',
          term_unit:accepted.term_unit||'days',
          payment_frequency:accepted.payment_frequency||'daily',
          scheduled_payment:accepted.payment_amount||'',
          fees:accepted.fees||'',
          funded_date:new Date().toISOString().slice(0,10),
          notes:accepted.notes||'',
        });
      } else {
        nextFundedDetails=d.funded_details;
      }
    } else {
      nextFundedDetails=d.funded_details;
    }
    // Criteria — store undefined as "preserve existing", null as "clear",
    // anything else as the new JSON. Lets clients PATCH criteria without
    // having to round-trip the whole deal record.
    let nextCriteria;
    if(criteria===undefined)nextCriteria=d.criteria;
    else nextCriteria=criteria?JSON.stringify(criteria):null;
    await db.run(`UPDATE active_deals SET deal_name=?,first_name=?,last_name=?,phone=?,email=?,rep=?,deal_date=?,notes=?,offers=?,status=?,funded_details=?,criteria=?,updated_at=NOW() WHERE id=?`,
      [deal_name??d.deal_name,first_name??d.first_name,last_name??d.last_name,phone??d.phone,email??d.email,rep??d.rep,deal_date??d.deal_date,notes??d.notes,JSON.stringify(offers??JSON.parse(d.offers||'[]')),newStatus,nextFundedDetails,nextCriteria,req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/active-deals/:id',auth,async(req,res)=>{
  try{
    const d=await db.get(`SELECT * FROM active_deals WHERE id=? AND company_id=?`,[req.params.id,req.session.user.company_id]);
    if(!d)return res.status(404).json({error:'Not found'});
    const canDel=['admin','superadmin'].includes(req.session.user.role)||d.created_by===req.session.user.id;
    if(!canDel)return res.status(403).json({error:'Forbidden'});
    await db.run(`DELETE FROM active_deals WHERE id=? AND company_id=?`,[req.params.id,req.session.user.company_id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Send Emails ───────────────────────────────────────────────────────────────
app.post('/api/send-emails',auth,async(req,res)=>{
  try{
    const{deal_name,deal_id,notes,funders,cc,urgent,attachments,existing_submission_id}=req.body;
    const co=await db.get(`SELECT * FROM companies WHERE id=?`,[req.session.user.company_id]);
    const uRow=await db.get(`SELECT * FROM users WHERE id=?`,[req.session.user.id]);
    const mode=co.rep_email_mode||'rep';
    const sendEmail=mode==='master'?co.master_email:(uRow.personal_email||co.master_email);
    const sendPass=mode==='master'?co.master_email_pass:(uRow.personal_email_pass||co.master_email_pass);
    if(!sendEmail||!sendPass)return res.status(400).json({error:'No email configured. Set one in Profile or Settings.'});
    const transporter=nodemailer.createTransport({service:'gmail',auth:{user:sendEmail,pass:sendPass}});
    const sig=uRow.email_signature||co.email_signature||'';
    const subject=`${urgent?'[URGENT] ':''}NEW DEAL - ${deal_name}`;
    const results=[];const seen=new Set();
    for(const funder of funders){
      const key=(funder.name||'').trim().toLowerCase();if(seen.has(key))continue;seen.add(key);
      const emails=(funder.emails||[]).filter(e=>e!=='portal'&&e&&e.includes('@'));
      if(!emails.length){results.push({name:funder.name,tier:funder.tier,status:'skipped',msg:'Portal only / no email'});continue;}
      try{
        const bodyText=[notes||'',sig?('\n\n'+sig):''].join('').trim();
        const htmlBody=`<div style="white-space:pre-wrap">${(notes||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>${sig?`<br><div>${sig.replace(/\n/g,'<br>')}</div>`:''}`;
        const mailAtts=(attachments||[]).map(a=>({filename:a.filename,content:a.content,encoding:a.encoding,contentType:a.contentType}));
        const ccList=cc?cc.split(',').map(e=>e.trim()).filter(Boolean):[];
        await transporter.sendMail({from:`"${co.name}" <${sendEmail}>`,to:emails.join(', '),cc:ccList.length?ccList.join(', '):undefined,subject,text:bodyText,html:htmlBody,attachments:mailAtts});
        results.push({name:funder.name,tier:funder.tier,emails,status:'ok',msg:'Sent'});
      }catch(e){results.push({name:funder.name,tier:funder.tier,status:'error',msg:e.message});}
    }
    if(results.length){
      const sentFunders=results.filter(x=>x.status==='ok');
      let subId;
      if(existing_submission_id){
        const ex=await db.get(`SELECT id FROM deal_submissions WHERE id=? AND company_id=?`,[existing_submission_id,req.session.user.company_id]);
        if(ex){
          subId=ex.id;
          const prev=await db.get(`SELECT funders_sent FROM deal_submissions WHERE id=?`,[subId]);
          await db.run(`UPDATE deal_submissions SET funders_sent=? WHERE id=?`,[JSON.stringify([...JSON.parse(prev.funders_sent||'[]'),...sentFunders]),subId]);
        }
      }
      if(!subId){
        const sub=await db.get(`INSERT INTO deal_submissions(company_id,deal_name,deal_id,submitted_by,submitted_by_id,funders_sent,notes)VALUES(?,?,?,?,?,?,?)RETURNING id`,
          [req.session.user.company_id,deal_name,deal_id||null,req.session.user.display_name||req.session.user.username,req.session.user.id,JSON.stringify(sentFunders),notes||'']);
        subId=sub.id;
      }
      for(const sf of results){
        const status=sf.status==='ok'?'No Response':sf.status==='skipped'?'Portal Only':'Send Error';
        await db.run(`INSERT INTO submission_funders(submission_id,funder_name,tier,emails_sent,status,notes)VALUES(?,?,?,?,?,?)`,
          [subId,sf.name,sf.tier||'',JSON.stringify(sf.emails||[]),status,sf.msg||'']);
      }
    }
    res.json({ok:true,results,sent_from:sendEmail});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Submissions ───────────────────────────────────────────────────────────────
app.get('/api/submissions',auth,async(req,res)=>{
  try{
    const{id:uid,role,company_id:cid}=req.session.user;
    const filter=await getVisFilter(uid,role,cid);
    let subs;
    if(!filter){subs=await db.all(`SELECT * FROM deal_submissions WHERE company_id=? ORDER BY created_at DESC`,[cid]);}
    else if(filter.names){
      const ph=filter.names.map(()=>'?').join(',');
      const uRows=await db.all(`SELECT * FROM users WHERE company_id=? AND(display_name IN(${ph})OR username IN(${ph}))`,[cid,...filter.names,...filter.names]);
      const ids=[...new Set([uid,...uRows.map(u=>u.id)])];
      const idph=ids.map(()=>'?').join(',');
      subs=await db.all(`SELECT * FROM deal_submissions WHERE company_id=? AND submitted_by_id IN(${idph})ORDER BY created_at DESC`,[cid,...ids]);
    }else{subs=await db.all(`SELECT * FROM deal_submissions WHERE company_id=? AND submitted_by_id=? ORDER BY created_at DESC`,[cid,uid]);}
    for(const s of subs)s.funder_statuses=await db.all(`SELECT * FROM submission_funders WHERE submission_id=?`,[s.id]);
    res.json(subs);
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/submissions/manual',auth,async(req,res)=>{
  try{
    const{deal_name,notes,funders}=req.body;
    if(!deal_name)return res.status(400).json({error:'Deal name required'});
    const sub=await db.get(`INSERT INTO deal_submissions(company_id,deal_name,deal_id,submitted_by,submitted_by_id,funders_sent,notes,is_manual)VALUES(?,?,NULL,?,?,?,?,1)RETURNING id`,
      [req.session.user.company_id,deal_name,req.session.user.display_name||req.session.user.username,req.session.user.id,JSON.stringify(funders||[]),notes||'']);
    for(const f of(funders||[])){
      if(!f.name)continue;
      await db.run(`INSERT INTO submission_funders(submission_id,funder_name,tier,emails_sent,status,notes)VALUES(?,?,?,'[]',?,?)`,
        [sub.id,f.name,f.tier||'',f.status||'No Response',f.notes||'']);
    }
    res.json({ok:true,id:sub.id});
  }catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/submissions/:id',adminOnly,async(req,res)=>{
  try{
    const sub=await db.get(`SELECT * FROM deal_submissions WHERE id=? AND company_id=?`,[req.params.id,req.session.user.company_id]);
    if(!sub)return res.status(404).json({error:'Not found'});
    await db.run(`DELETE FROM submission_funders WHERE submission_id=?`,[req.params.id]);
    await db.run(`DELETE FROM deal_submissions WHERE id=?`,[req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.put('/api/submissions/funders/:id',auth,async(req,res)=>{
  try{
    const sf=await db.get(`SELECT sf.*,ds.submitted_by_id,ds.company_id FROM submission_funders sf JOIN deal_submissions ds ON ds.id=sf.submission_id WHERE sf.id=?`,[req.params.id]);
    if(!sf)return res.status(404).json({error:'Not found'});
    if(sf.company_id!==req.session.user.company_id&&req.session.user.role!=='superadmin')return res.status(403).json({error:'Forbidden'});
    const{status,notes}=req.body;
    await db.run(`UPDATE submission_funders SET status=?,notes=?,updated_at=NOW() WHERE id=?`,[status??sf.status,notes??sf.notes,req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/submissions/funders/add',auth,async(req,res)=>{
  try{
    const{submission_id,funder_name,status,notes}=req.body;
    if(!submission_id||!funder_name)return res.status(400).json({error:'submission_id and funder_name required'});
    const isSA=req.session.user.role==='superadmin';
    const sub=isSA?await db.get(`SELECT * FROM deal_submissions WHERE id=?`,[submission_id]):await db.get(`SELECT * FROM deal_submissions WHERE id=? AND company_id=?`,[submission_id,req.session.user.company_id]);
    if(!sub)return res.status(404).json({error:'Submission not found'});
    const r=await db.get(`INSERT INTO submission_funders(submission_id,funder_name,tier,emails_sent,status,notes)VALUES(?,?,?,?,?,?)RETURNING id`,
      [submission_id,funder_name.trim(),'','[]',status||'No Response',notes||'']);
    res.json({ok:true,id:r.id});
  }catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/submissions/funders/:id',auth,async(req,res)=>{
  try{
    const sf=await db.get(`SELECT sf.*,ds.company_id FROM submission_funders sf JOIN deal_submissions ds ON ds.id=sf.submission_id WHERE sf.id=?`,[req.params.id]);
    if(!sf)return res.status(404).json({error:'Not found'});
    if(sf.company_id!==req.session.user.company_id&&req.session.user.role!=='superadmin')return res.status(403).json({error:'Forbidden'});
    await db.run(`DELETE FROM submission_funders WHERE id=?`,[req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Funded Board ──────────────────────────────────────────────────────────────
app.get('/api/funded-board',auth,async(req,res)=>{
  try{res.json(await db.all(`SELECT * FROM funded_board WHERE company_id=? ORDER BY created_at DESC`,[req.session.user.company_id]));}
  catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/funded-board',auth,async(req,res)=>{
  try{
    const{amount,funder_name,rep_name,notes,custom_fields,deal_name}=req.body;
    if(!amount||!funder_name)return res.status(400).json({error:'Amount and funder required'});
    const u=await db.get(`SELECT commission_rate FROM users WHERE id=?`,[req.session.user.id]);
    const co=await db.get(`SELECT commission_rate FROM companies WHERE id=?`,[req.session.user.company_id]);
    const rate=u?.commission_rate||co?.commission_rate||0;
    const commission=parseFloat(amount)*(rate/100);
    await db.run(`INSERT INTO funded_board(company_id,user_id,username,display_name,amount,commission,funder_name,notes,custom_fields,deal_name)VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [req.session.user.company_id,req.session.user.id,req.session.user.username,rep_name||req.session.user.display_name||req.session.user.username,parseFloat(amount),commission,funder_name,notes||'',JSON.stringify(custom_fields||{}),deal_name||'']);
    // Auto-update matching active deal to Funded
    try{
      const repName=rep_name||req.session.user.display_name||req.session.user.username;
      await db.run(
        `UPDATE active_deals SET status='Funded',updated_at=NOW() WHERE company_id=? AND rep=? AND status NOT IN('Dead','Funded') ORDER BY updated_at DESC LIMIT 1`,
        [req.session.user.company_id,repName]
      );
    }catch(e){}
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/funded-board/:id',auth,async(req,res)=>{
  try{
    const e=await db.get(`SELECT * FROM funded_board WHERE id=? AND company_id=?`,[req.params.id,req.session.user.company_id]);
    if(!e)return res.status(404).json({error:'Not found'});
    if(!['admin','superadmin'].includes(req.session.user.role)&&e.user_id!==req.session.user.id)return res.status(403).json({error:'Forbidden'});
    await db.run(`DELETE FROM funded_board WHERE id=?`,[req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/funded-board/send-email',auth,async(req,res)=>{
  try{
    const{entry_id}=req.body;
    const entry=await db.get(`SELECT * FROM funded_board WHERE id=? AND company_id=?`,[entry_id,req.session.user.company_id]);
    if(!entry)return res.status(404).json({error:'Entry not found'});
    const co=await db.get(`SELECT * FROM companies WHERE id=?`,[req.session.user.company_id]);
    const uRow=await db.get(`SELECT * FROM users WHERE id=?`,[req.session.user.id]);
    // Get email config
    const config=JSON.parse(co.funded_email_config||'null');
    if(!config||!config.to_email)return res.status(400).json({error:'Funded email not configured. Ask admin to set it up in Settings.'});
    // Determine send-from
    const mode=co.rep_email_mode||'rep';
    const sendEmail=mode==='master'?co.master_email:(uRow.personal_email||co.master_email);
    const sendPass=mode==='master'?co.master_email_pass:(uRow.personal_email_pass||co.master_email_pass);
    if(!sendEmail||!sendPass)return res.status(400).json({error:'No send email configured. Set one in Profile or Settings.'});
    // Build email body from template
    const customFields=JSON.parse(entry.custom_fields||'{}');
    const repName=entry.display_name||entry.username;
    const fmt=n=>'$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
    let subject=config.subject||'Funded Deal - {{deal_name}}';
    let body=config.body||'Deal: {{deal_name}}\nAmount: {{amount}}\nFunder: {{funder_name}}\nRep: {{rep_name}}';
    // Replace standard tokens
    const tokens={
      '{{deal_name}}':entry.notes||'N/A',
      '{{amount}}':fmt(entry.amount),
      '{{funder_name}}':entry.funder_name,
      '{{rep_name}}':repName,
      '{{commission}}':fmt(entry.commission),
      '{{date}}':new Date(entry.created_at).toLocaleDateString(),
      '{{notes}}':entry.notes||'',
    };
    for(const[k,v]of Object.entries(tokens)){subject=subject.split(k).join(v);body=body.split(k).join(v);}
    // Replace custom field tokens
    for(const[k,v]of Object.entries(customFields)){
      const token='{{'+k+'}}';
      subject=subject.split(token).join(v);
      body=body.split(token).join(v);
    }
    const sig=uRow.email_signature||co.email_signature||'';
    const fullBody=[body,sig?('\n\n'+sig):''].join('').trim();
    const htmlBody=`<div style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px">${fullBody.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
    const transporter=nodemailer.createTransport({service:'gmail',auth:{user:sendEmail,pass:sendPass}});
    const toList=config.to_email.split(',').map(e=>e.trim()).filter(Boolean);
    const ccList=config.cc_email?config.cc_email.split(',').map(e=>e.trim()).filter(Boolean):[];
    await transporter.sendMail({from:`"${co.name}" <${sendEmail}>`,to:toList.join(', '),cc:ccList.length?ccList.join(', '):undefined,subject,text:fullBody,html:htmlBody});
    res.json({ok:true,sent_to:toList,subject});
  }catch(e){res.status(500).json({error:e.message});}
});

app.delete('/api/funded-board',adminOnly,async(req,res)=>{
  try{await db.run(`DELETE FROM funded_board WHERE company_id=?`,[req.session.user.company_id]);res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message});}
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard',auth,async(req,res)=>{
  try{
    const cid=req.session.user.company_id,uid=req.session.user.id,role=req.session.user.role;
    const isAdmin=['admin','superadmin'].includes(role);
    const[totalDeals,activeDeals,totalFunded,myFunded,recentSubs,topReps]=await Promise.all([
      db.get(`SELECT COUNT(*)as n FROM active_deals WHERE company_id=?${isAdmin?'':' AND created_by=?'}`,isAdmin?[cid]:[cid,uid]),
      db.get(`SELECT COUNT(*)as n FROM active_deals WHERE company_id=? AND status NOT IN('Dead','Funded')${isAdmin?'':' AND created_by=?'}`,isAdmin?[cid]:[cid,uid]),
      db.get(`SELECT COALESCE(SUM(amount),0)as total,COALESCE(SUM(commission),0)as commission FROM funded_board WHERE company_id=?`,[cid]),
      db.get(`SELECT COALESCE(SUM(amount),0)as total,COALESCE(SUM(commission),0)as commission FROM funded_board WHERE company_id=? AND user_id=?`,[cid,uid]),
      db.all(`SELECT * FROM deal_submissions WHERE company_id=?${isAdmin?'':' AND submitted_by_id=?'} ORDER BY created_at DESC LIMIT 5`,isAdmin?[cid]:[cid,uid]),
      isAdmin?db.all(`SELECT display_name,username,COALESCE(SUM(amount),0)as total,COALESCE(SUM(commission),0)as commission,COUNT(*)as deals FROM funded_board WHERE company_id=? GROUP BY display_name,username ORDER BY total DESC LIMIT 10`,[cid]):Promise.resolve([]),
    ]);
    res.json({totalDeals:totalDeals?.n||0,activeDeals:activeDeals?.n||0,totalFunded,myFunded,recentSubs,topReps});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Superadmin ────────────────────────────────────────────────────────────────
app.get('/api/superadmin/companies',superOnly,async(req,res)=>{
  try{res.json(await db.all(`SELECT * FROM companies ORDER BY id`));}
  catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/superadmin/companies',superOnly,async(req,res)=>{
  try{
    const{name,tagline,color,admin_username,admin_password}=req.body;
    if(!name||!admin_username||!admin_password)return res.status(400).json({error:'Name, username and password required'});
    const co=await db.get(`INSERT INTO companies(name,tagline,color)VALUES(?,?,?)RETURNING id`,[name,tagline||'',color||'#2563eb']);
    await db.run(`INSERT INTO users(company_id,username,password,role,display_name,tab_access)VALUES(?,?,?,'admin',?,?)`,
      [co.id,admin_username,bcrypt.hashSync(admin_password,10),admin_username,JSON.stringify(ALL_MODULES)]);
    const mf=await db.get(`SELECT data FROM funders WHERE company_id IS NULL ORDER BY id DESC LIMIT 1`);
    if(mf)await db.run(`INSERT INTO funders(company_id,data)VALUES(?,?)`,[co.id,mf.data]);
    res.json({ok:true,id:co.id});
  }catch(e){res.status(400).json({error:e.message});}
});
app.put('/api/superadmin/companies/:id',superOnly,async(req,res)=>{
  try{
    const co=await db.get(`SELECT * FROM companies WHERE id=?`,[req.params.id]);
    if(!co)return res.status(404).json({error:'Not found'});
    const{name,tagline,color,master_email,master_email_pass,funder_mode,module_access}=req.body;
    const newMode=funder_mode??co.funder_mode??'master';
    if(newMode==='template'){
      const ex=await db.get(`SELECT id FROM funders WHERE company_id=?`,[req.params.id]);
      if(!ex){const mf=await db.get(`SELECT data FROM funders WHERE company_id IS NULL ORDER BY id DESC LIMIT 1`);if(mf)await db.run(`INSERT INTO funders(company_id,data)VALUES(?,?)`,[req.params.id,mf.data]);}
    }
    await db.run(`UPDATE companies SET name=?,tagline=?,color=?,master_email=?,master_email_pass=?,funder_mode=?,module_access=? WHERE id=?`,
      [name??co.name,tagline??co.tagline,color??co.color,master_email??co.master_email,
       master_email_pass!==undefined?master_email_pass:co.master_email_pass,newMode,module_access??co.module_access,req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/superadmin/companies/:id/users',superOnly,async(req,res)=>{
  try{res.json(await db.all(`SELECT id,username,display_name,role,tab_access,created_at FROM users WHERE company_id=?`,[req.params.id]));}
  catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/superadmin/companies/:id/users',superOnly,async(req,res)=>{
  try{
    const{username,password,display_name,role}=req.body;
    if(!username||!password)return res.status(400).json({error:'Username and password required'});
    await db.run(`INSERT INTO users(company_id,username,password,role,display_name,tab_access,must_change_password)VALUES(?,?,?,?,?,'[]',1)`,
      [parseInt(req.params.id),username,bcrypt.hashSync(password,10),role||'user',display_name||username]);
    res.json({ok:true});
  }catch(e){res.status(400).json({error:'Username already exists'});}
});
app.put('/api/superadmin/users/:id',superOnly,async(req,res)=>{
  try{
    const u=await db.get(`SELECT * FROM users WHERE id=?`,[req.params.id]);
    if(!u)return res.status(404).json({error:'Not found'});
    const{display_name,role,tab_access,password,personal_email}=req.body;
    if(password)await db.run(`UPDATE users SET password=?,must_change_password=0 WHERE id=?`,[bcrypt.hashSync(password,10),req.params.id]);
    await db.run(`UPDATE users SET display_name=?,role=?,tab_access=?,personal_email=? WHERE id=?`,
      [display_name??u.display_name,role??u.role,tab_access??u.tab_access,personal_email??u.personal_email,req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/superadmin/users/:id',superOnly,async(req,res)=>{
  try{
    const u=await db.get(`SELECT * FROM users WHERE id=?`,[req.params.id]);
    if(!u)return res.status(404).json({error:'Not found'});
    if(u.role==='superadmin')return res.status(403).json({error:'Cannot delete superadmin'});
    await db.run(`DELETE FROM users WHERE id=?`,[req.params.id]);res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/superadmin/companies/:id',superOnly,async(req,res)=>{
  try{
    const id=parseInt(req.params.id);
    if(id===1)return res.status(400).json({error:'Cannot delete master company'});
    await db.run(`DELETE FROM funded_board WHERE company_id=?`,[id]);
    await db.run(`DELETE FROM submission_funders WHERE submission_id IN(SELECT id FROM deal_submissions WHERE company_id=?)`,[id]);
    await db.run(`DELETE FROM deal_submissions WHERE company_id=?`,[id]);
    await db.run(`DELETE FROM active_deals WHERE company_id=?`,[id]);
    await db.run(`DELETE FROM funders WHERE company_id=?`,[id]);
    await db.run(`DELETE FROM teams WHERE company_id=?`,[id]);
    await db.run(`DELETE FROM users WHERE company_id=?`,[id]);
    await db.run(`DELETE FROM companies WHERE id=?`,[id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── AI proxy ──────────────────────────────────────────────────────────────────
app.post('/api/ai',auth,async(req,res)=>{
  try{
    const apiKey=process.env.ANTHROPIC_API_KEY||'';
    if(!apiKey)return res.status(400).json({error:'ANTHROPIC_API_KEY not configured'});
    const response=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify(req.body),
    });
    const data=await response.json();
    res.status(response.status).json(data);
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Setup/Emergency ───────────────────────────────────────────────────────────
app.get('/setup/:key',async(req,res)=>{
  if(req.params.key!=='cortada-setup-2024')return res.status(403).send('Forbidden');
  try{
    const hash=bcrypt.hashSync('Admin1!',10);
    const ex=await db.get(`SELECT id FROM users WHERE LOWER(username)IN('admin','jj','jj@cortadacapitalgroup.com')ORDER BY id LIMIT 1`);
    let msg;
    if(ex){
      await pool.query(`UPDATE users SET username=$1,password=$2,role=$3,display_name=$4,tab_access=$5,must_change_password=0 WHERE id=$6`,
        ['admin',hash,'superadmin','Admin',JSON.stringify(ALL_MODULES),ex.id]);
      msg='Updated user id='+ex.id;
    }else{
      const r=await pool.query(`INSERT INTO users(company_id,username,password,role,display_name,tab_access,must_change_password)VALUES(1,$1,$2,$3,$4,$5,0)RETURNING id`,
        ['admin',hash,'superadmin','Admin',JSON.stringify(ALL_MODULES)]);
      msg='Created user id='+r.rows[0]?.id;
    }
    const users=await db.all(`SELECT id,username,role,company_id FROM users`);
    res.json({ok:true,result:msg,login:{username:'admin',password:'Admin1!'},users});
  }catch(e){res.status(500).json({error:e.message});}
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health',(req,res)=>res.json({ok:true,ts:Date.now()}));
app.get('/health/db',async(req,res)=>{
  try{await pool.query('SELECT 1');res.json({ok:true,db:'connected',url_set:!!process.env.DATABASE_URL});}
  catch(e){res.status(500).json({ok:false,error:e.message,url_set:!!process.env.DATABASE_URL});}
});
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
async function start(){
  const PORT=process.env.PORT||8080;
  app.listen(PORT,'0.0.0.0',()=>console.log(`Server on ${PORT} | ROOT=${ROOT} | DB=${!!process.env.DATABASE_URL}`));
  try{await initDb();console.log('DB ready');}
  catch(e){console.error('DB init error (non-fatal):',e.message);}
}
start().catch(e=>{console.error('Fatal:',e);process.exit(1);});
