import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool,tenantTx,verifyRuntimeRole } from '../server/db.js';
import { createApp } from '../server/app.js';
import { signAccess,commissionFor } from '../server/security.js';
import { hmacFields,verifyCinetpay } from '../server/cinetpay.js';
import { settlePayment } from '../server/payments.js';
import { generateInvoices } from '../server/routes.js';
import { receiptData,receiptPdf } from '../server/receipt.js';
const db=new PGlite();let app;const fixture={};
const origin='https://lagune.test';
const query=async(sql,params=[])=>{const result=await db.query(sql,params);return {...result,rowCount:result.affectedRows??result.rows.length};};
const cookie=user=>'access='+signAccess(user,user.session);
async function insertUser(company,role,name){const {rows:[user]}=await query('INSERT INTO users(company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING *',[company,name,name+'@example.com',await bcrypt.hash('StrongPassword!123',4),role]);const {rows:[session]}=await query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day') RETURNING id",[user.id,crypto.randomUUID()]);return {...user,session:session.id};}
before(async()=>{
 process.env.JWT_SECRET='a-secure-test-secret-with-more-than-32-characters';process.env.APP_ORIGIN=origin;process.env.NODE_ENV='production';
 await db.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
 for(const label of ['a','b']){const {rows:[company]}=await query('INSERT INTO companies(name) VALUES($1) RETURNING *',['Agence '+label]);fixture[label]=company;}
 fixture.admin=await insertUser(fixture.a.id,'agency_admin','admin');fixture.otherAdmin=await insertUser(fixture.b.id,'agency_admin','otheradmin');
 fixture.owner=await insertUser(fixture.a.id,'owner','owner');fixture.otherOwner=await insertUser(fixture.a.id,'owner','otherowner');fixture.tenant=await insertUser(fixture.a.id,'tenant','tenant');fixture.saas=await insertUser(null,'saas_admin','saas');
 for(const [key,company,owner] of [['p1',fixture.a.id,fixture.owner.id],['p2',fixture.a.id,fixture.otherOwner.id],['p3',fixture.b.id,null]]){
  fixture[key]=(await query("INSERT INTO properties(company_id,name,type,city,district,rent,commission,owner_id) VALUES($1,$2,'Villa','Abidjan','Cocody',100000,8,$3) RETURNING *",[company,key,owner])).rows[0];
 }
 for(const [key,property,user] of [['l1',fixture.p1,fixture.tenant.id],['l2',fixture.p2,null],['l3',fixture.p3,null]]){
  const tenant=(await query("INSERT INTO tenants(company_id,name,email,phone,user_id) VALUES($1,$2,$3,'0700000000',$4) RETURNING *",[property.company_id,key,key+'@example.com',user])).rows[0];
  fixture[key]=(await query("INSERT INTO leases(company_id,property_id,tenant_id,start_date,end_date,rent) VALUES($1,$2,$3,current_date-30,current_date+365,100000) RETURNING *",[property.company_id,property.id,tenant.id])).rows[0];
 }
 // Test with a genuine non-owner SQL role: RLS is actually enforced by PostgreSQL.
 await db.exec('CREATE ROLE test_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO test_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO test_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO test_app; SET ROLE test_app;');
 pool.query=query;pool.connect=async()=>({query,release(){}});
 await tenantTx(fixture.a.id,client=>generateInvoices(client,fixture.a.id));await tenantTx(fixture.b.id,client=>generateInvoices(client,fixture.b.id));app=createApp();
});
after(async()=>{await db.close();await pool.end();});
test('startup accepts the restricted role and rejects the database owner',async()=>{await verifyRuntimeRole();await db.exec('RESET ROLE');try{await assert.rejects(verifyRuntimeRole,/non propriétaire/);}finally{await db.exec('SET ROLE test_app');}});
test('RLS denies tenant data without a transaction context',async()=>{assert.equal((await query('SELECT * FROM properties')).rows.length,0);});
test('RLS filters every agency and rejects writes to another agency',async()=>{
 const rows=await tenantTx(fixture.a.id,async client=>(await client.query('SELECT * FROM properties')).rows);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.company_id===fixture.a.id));
 await assert.rejects(()=>tenantTx(fixture.a.id,client=>client.query("INSERT INTO properties(company_id,name,type,city,district,rent) VALUES($1,'Forbidden','Villa','Abidjan','X',100000)",[fixture.b.id])),/row-level security/);
});
test('anonymous API requests are rejected',async()=>{await request(app).get('/api/data').expect(401);});
test('agency admin sees only its company data',async()=>{const {body}=await request(app).get('/api/data').set('Cookie',cookie(fixture.admin)).expect(200);assert.equal(body.properties.length,2);assert.equal(body.leases.length,2);assert.ok(body.invoices.every(i=>i.company_id===fixture.a.id));});
test('owners and tenants see only their own leases and properties',async()=>{
 for(const user of [fixture.owner,fixture.tenant]){const {body}=await request(app).get('/api/data').set('Cookie',cookie(user)).expect(200);assert.equal(body.properties.length,1);assert.equal(body.properties[0].id,fixture.p1.id);assert.equal(body.leases.length,1);assert.equal(body.users.length,0);}
});
test('client company_id is rejected in query, body and nested body',async()=>{
 await request(app).get('/api/data?company_id='+fixture.b.id).set('Cookie',cookie(fixture.admin)).expect(400);
 for(const body of [{company_id:fixture.b.id},{nested:{company_id:fixture.b.id}}])await request(app).post('/api/properties').set('Origin',origin).set('Cookie',cookie(fixture.admin)).send(body).expect(400);
});
test('unsafe requests require the configured origin',async()=>{await request(app).post('/api/properties').set('Origin','https://evil.test').set('Cookie',cookie(fixture.admin)).send({}).expect(403);});
test('read-only owner cannot create properties or users',async()=>{for(const path of ['/api/properties','/api/users'])await request(app).post(path).set('Origin',origin).set('Cookie',cookie(fixture.owner)).send({}).expect(403);});
test('same-tenant and cross-tenant object IDOR are denied for receipts',async()=>{
 const invoices=await tenantTx(fixture.a.id,async client=>(await client.query('UPDATE invoices SET paid_at=now() RETURNING *')).rows);
 const otherInvoice=await tenantTx(fixture.b.id,async client=>(await client.query('UPDATE invoices SET paid_at=now() RETURNING *')).rows[0]);
 const own=invoices.find(i=>i.lease_id===fixture.l1.id);const notOwn=invoices.find(i=>i.lease_id===fixture.l2.id);
 await request(app).get('/api/invoices/'+own.id+'/receipt').set('Cookie',cookie(fixture.tenant)).expect(200).expect('Content-Type',/pdf/);
 for(const invoice of [notOwn,otherInvoice])await request(app).get('/api/invoices/'+invoice.id+'/receipt').set('Cookie',cookie(fixture.tenant)).expect(404);
 await tenantTx(fixture.a.id,client=>client.query('UPDATE invoices SET paid_at=NULL'));
});
test('cross-agency references cannot create a lease',async()=>{await assert.rejects(()=>tenantTx(fixture.a.id,client=>client.query("INSERT INTO leases(company_id,property_id,tenant_id,start_date,end_date,rent,status) VALUES($1,$2,$3,current_date,current_date+30,100000,'ended')",[fixture.a.id,fixture.p3.id,fixture.l1.tenant_id])),/foreign key/);});
test('expired or tampered JWT does not authenticate',async()=>{
 const expired=jwt.sign({sub:fixture.admin.id},process.env.JWT_SECRET,{expiresIn:-1,issuer:'lagune-immo',audience:'lagune-web'});
 await request(app).get('/api/data').set('Cookie','access='+expired).expect(401);await request(app).get('/api/data').set('Cookie',cookie(fixture.admin)+'tamper').expect(401);
});
test('secure login cookies, refresh rotation and immediate logout revocation',async()=>{
 const login=await request(app).post('/api/auth/login').set('Origin',origin).send({email:'admin@example.com',password:'StrongPassword!123'}).expect(200);
 const cookies=login.headers['set-cookie'];for(const c of cookies){assert.match(c,/HttpOnly/);assert.match(c,/Secure/);assert.match(c,/SameSite=Strict/);}
 const old=cookies.map(c=>c.split(';')[0]);const refresh=await request(app).post('/api/auth/refresh').set('Origin',origin).set('Cookie',old).expect(200);
 await request(app).post('/api/auth/refresh').set('Origin',origin).set('Cookie',old).expect(401);
 const fresh=refresh.headers['set-cookie'].map(c=>c.split(';')[0]);await request(app).post('/api/auth/logout').set('Origin',origin).set('Cookie',fresh).expect(204);
 await request(app).get('/api/data').set('Cookie',fresh).expect(401);
});
test('signed webhook refuses missing, malformed and altered HMAC',()=>{
 const body=Object.fromEntries(hmacFields.map(k=>[k,'']));Object.assign(body,{cpm_site_id:'123',cpm_trans_id:'abc',cpm_amount:'100000',cpm_currency:'XOF'});const secret='merchant-secret';
 const token=crypto.createHmac('sha256',secret).update(hmacFields.map(k=>body[k]).join('')).digest('hex');
 assert.ok(verifyCinetpay(body,token,secret));assert.equal(verifyCinetpay({...body,cpm_amount:'500'},token,secret),false);assert.equal(verifyCinetpay(body,'',secret),false);assert.equal(verifyCinetpay(body,'bad',secret),false);
});
test('webhook HTTP refuses unsigned notifications before calling provider',async()=>{
 process.env.CINETPAY_API_KEY='test';process.env.CINETPAY_SITE_ID='123';process.env.CINETPAY_SECRET_KEY='secret';
 await request(app).post('/api/webhooks/cinetpay').type('form').send({cpm_trans_id:'abc'}).expect(401);
});
test('verified payment is idempotent; wrong amount cannot settle',async()=>{
 await tenantTx(fixture.a.id,async client=>{
  const invoice=(await client.query('SELECT * FROM invoices WHERE lease_id=$1',[fixture.l1.id])).rows[0];
  const payment=(await client.query('INSERT INTO payments(company_id,invoice_id,transaction_id,amount) VALUES($1,$2,$3,$4) RETURNING *',[fixture.a.id,invoice.id,'test-transaction',invoice.amount])).rows[0];
  await assert.rejects(()=>settlePayment(client,payment,{code:'00',data:{status:'ACCEPTED',amount:1,currency:'XOF'}}),/Montant/);
  assert.equal((await client.query('SELECT paid_at FROM invoices WHERE id=$1',[invoice.id])).rows[0].paid_at,null);
  const verified={code:'00',data:{status:'ACCEPTED',amount:100000,currency:'XOF'}};
  assert.equal(await settlePayment(client,payment,verified),true);assert.equal(await settlePayment(client,payment,verified),false);
  assert.equal((await client.query('SELECT * FROM mail_jobs WHERE invoice_id=$1',[invoice.id])).rows.length,1);
  assert.equal((await client.query("SELECT * FROM audit_logs WHERE action='payment.accepted'")).rows.length,1);
  const pdf=await receiptPdf(await receiptData(client,invoice.id,fixture.a.id));assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 });
});
test('monthly invoice generation is idempotent and commission is snapshotted',async()=>{
 await tenantTx(fixture.a.id,async client=>{assert.equal((await generateInvoices(client,fixture.a.id)).rowCount,0);await client.query('UPDATE properties SET commission=10 WHERE id=$1',[fixture.p1.id]);const invoice=(await client.query('SELECT commission FROM invoices WHERE lease_id=$1',[fixture.l1.id])).rows[0];assert.equal(Number(invoice.commission),8);});
 assert.equal(commissionFor(250000,8),20000);assert.equal(commissionFor(100005,7),7000);
});
test('suspended agency sessions stop working immediately',async()=>{
 await query('UPDATE companies SET active=false WHERE id=$1',[fixture.b.id]);await request(app).get('/api/data').set('Cookie',cookie(fixture.otherAdmin)).expect(401);await query('UPDATE companies SET active=true WHERE id=$1',[fixture.b.id]);
});
test('SaaS admin can list agencies but cannot read rental data',async()=>{await request(app).get('/api/companies').set('Cookie',cookie(fixture.saas)).expect(200);await request(app).get('/api/data').set('Cookie',cookie(fixture.saas)).expect(403);await request(app).get('/api/companies').set('Cookie',cookie(fixture.admin)).expect(403);});
