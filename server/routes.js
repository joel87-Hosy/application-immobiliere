import { z } from 'zod';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir,writeFile,readFile,unlink } from 'node:fs/promises';
import { pool,tenantTx,audit } from './db.js';
import { fail,uuid,allow,staff } from './security.js';
import { receiptData,receiptPdf } from './receipt.js';
const text=z.string().trim().min(1).max(200);
const money=z.coerce.number().int().min(100).max(100000000);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Date invalide');
const propertySchema=z.object({name:text,type:z.enum(['Appartement','Villa','Studio','Magasin','Bureau']),city:text,district:text,address:z.string().max(400).default(''),rent:money,commission:z.coerce.number().min(7).max(10),owner_id:uuid.nullable().default(null)}).strict();
const tenantSchema=z.object({name:text,email:z.string().email().max(200),phone:z.string().regex(/^\+?[0-9 ()-]{8,20}$/),user_id:uuid.nullable().default(null)}).strict();
const leaseSchema=z.object({property_id:uuid,tenant_id:uuid,start_date:date,end_date:date,rent:money,deposit:z.coerce.number().int().min(0).max(100000000)}).strict().refine(v=>v.end_date>=v.start_date,'La fin doit suivre le début.');
// All object reads for owner/tenant go through this ownership check, in addition to RLS.
export async function accessibleProperty(db,user,id) {
 const {rows:[property]}=await db.query(`SELECT p.* FROM properties p WHERE p.id=$1 AND p.company_id=$2 AND ($3 IN ('agency_admin','manager') OR ($3='owner' AND p.owner_id=$4) OR ($3='tenant' AND EXISTS(SELECT 1 FROM leases l JOIN tenants t ON t.id=l.tenant_id WHERE l.property_id=p.id AND t.user_id=$4)))`,[id,user.company_id,user.role,user.id]);
 if(!property) throw fail(404,'Bien introuvable.'); return property;
}
export async function accessibleLease(db,user,id) {
 const {rows:[lease]}=await db.query(`SELECT l.* FROM leases l JOIN properties p ON p.id=l.property_id JOIN tenants t ON t.id=l.tenant_id WHERE l.id=$1 AND l.company_id=$2 AND ($3 IN ('agency_admin','manager') OR ($3='owner' AND p.owner_id=$4) OR ($3='tenant' AND t.user_id=$4))`,[id,user.company_id,user.role,user.id]);
 if(!lease) throw fail(404,'Bail introuvable.'); return lease;
}
export async function generateInvoices(db,companyId) {
 return db.query(`INSERT INTO invoices(company_id,lease_id,period,due_date,amount,commission)
 SELECT l.company_id,l.id,date_trunc('month',current_date)::date,GREATEST(date_trunc('month',current_date)::date+4,l.start_date),l.rent,p.commission
 FROM leases l JOIN properties p ON p.id=l.property_id WHERE l.company_id=$1 AND l.status='active' AND l.start_date<=current_date AND l.end_date>=date_trunc('month',current_date)::date
 ON CONFLICT(lease_id,period) DO NOTHING RETURNING id`,[companyId]);
}
export function adminRoutes(app) {
 app.get('/api/companies',allow('saas_admin'),async(req,res)=>res.json((await pool.query('SELECT id,name,plan,active,created_at FROM companies ORDER BY created_at DESC')).rows));
 app.post('/api/companies',allow('saas_admin'),async(req,res)=>{
  const data=z.object({name:text,plan:z.enum(['Essentiel','Professionnel','Entreprise']),admin_name:text,admin_email:z.string().email().transform(v=>v.toLowerCase()),password:z.string().min(12).max(128)}).strict().parse(req.body);
  const passwordHash=await bcrypt.hash(data.password,12); const db=await pool.connect();
  try {await db.query('BEGIN'); const {rows:[company]}=await db.query('INSERT INTO companies(name,plan) VALUES($1,$2) RETURNING *',[data.name,data.plan]); await db.query("INSERT INTO users(company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'agency_admin')",[company.id,data.admin_name,data.admin_email,passwordHash]); await audit(db,req.user,'company.created',company.id); await db.query('COMMIT'); res.status(201).json(company);} catch(e){await db.query('ROLLBACK');throw e;} finally{db.release();}
 });
 app.patch('/api/companies/:id',allow('saas_admin'),async(req,res)=>{const {active,plan}=z.object({active:z.boolean(),plan:z.enum(['Essentiel','Professionnel','Entreprise'])}).strict().parse(req.body); const {rows:[company]}=await pool.query('UPDATE companies SET active=$1,plan=$2 WHERE id=$3 RETURNING *',[active,plan,uuid.parse(req.params.id)]); if(!company) throw fail(404,'Agence introuvable.'); await audit(pool,req.user,'company.updated',company.id); res.json(company);});
 app.get('/api/system',allow('saas_admin'),async(req,res)=>{const {rows:logs}=await pool.query('SELECT action,entity_id,created_at FROM audit_logs ORDER BY id DESC LIMIT 50'); res.json({uptime:Math.floor(process.uptime()),memory_mb:Math.round(process.memoryUsage().rss/1024/1024),logs});});
}
export function agencyRoutes(app) {
 app.use('/api',(req,res,next)=>req.user.company_id?next():next(fail(403,'Cette route est réservée aux agences.')));
 app.get('/api/data',async(req,res)=>res.json(await tenantTx(req.user.company_id,async db=>{
  const params=[req.user.company_id,req.user.role,req.user.id];
  const {rows:properties}=await db.query(`SELECT p.*,EXISTS(SELECT 1 FROM leases l WHERE l.property_id=p.id AND l.status='active') AS occupied FROM properties p WHERE p.company_id=$1 AND ($2 IN ('agency_admin','manager') OR ($2='owner' AND p.owner_id=$3) OR ($2='tenant' AND EXISTS(SELECT 1 FROM leases l JOIN tenants t ON t.id=l.tenant_id WHERE l.property_id=p.id AND t.user_id=$3))) ORDER BY p.created_at DESC`,params);
  const {rows:leases}=await db.query(`SELECT l.* FROM leases l JOIN properties p ON p.id=l.property_id JOIN tenants t ON t.id=l.tenant_id WHERE l.company_id=$1 AND ($2 IN ('agency_admin','manager') OR ($2='owner' AND p.owner_id=$3) OR ($2='tenant' AND t.user_id=$3))`,params);
  const leaseIds=leases.map(x=>x.id);
  const {rows:tenants}=await db.query(`SELECT t.* FROM tenants t WHERE t.company_id=$1 AND ($2 IN ('agency_admin','manager') OR ($2='tenant' AND t.user_id=$3) OR ($2='owner' AND EXISTS(SELECT 1 FROM leases l JOIN properties p ON p.id=l.property_id WHERE l.tenant_id=t.id AND p.owner_id=$3))) ORDER BY t.name`,params);
  const {rows:invoices}=await db.query('SELECT * FROM invoices WHERE company_id=$1 AND lease_id=ANY($2::uuid[]) ORDER BY due_date DESC',[req.user.company_id,leaseIds]);
  const {rows:tickets}=await db.query('SELECT * FROM tickets WHERE company_id=$1 AND property_id=ANY($2::uuid[]) AND ($3<>\'tenant\' OR created_by=$4) ORDER BY created_at DESC',[req.user.company_id,properties.map(x=>x.id),req.user.role,req.user.id]);
  const {rows:documents}=await db.query("SELECT id,lease_id,name,kind,created_at FROM documents WHERE company_id=$1 AND lease_id=ANY($2::uuid[]) AND ($3<>'owner' OR kind<>'identity') ORDER BY created_at DESC",[req.user.company_id,leaseIds,req.user.role]);
  const {rows:[company]}=await db.query('SELECT id,name,plan FROM companies WHERE id=$1',[req.user.company_id]);
  const users=staff.includes(req.user.role)?(await db.query('SELECT id,name,email,role FROM users WHERE company_id=$1 ORDER BY name',[req.user.company_id])).rows:[];
  return {properties,tenants,leases,invoices,tickets,documents,company,users};
 })));
 app.post('/api/properties',allow(...staff),async(req,res)=>{const d=propertySchema.parse(req.body); res.status(201).json(await tenantTx(req.user.company_id,async db=>{
  if(d.owner_id&&!(await db.query("SELECT id FROM users WHERE id=$1 AND company_id=$2 AND role='owner'",[d.owner_id,req.user.company_id])).rowCount) throw fail(400,'Propriétaire invalide.');
  const {rows:[row]}=await db.query('INSERT INTO properties(company_id,name,type,city,district,address,rent,commission,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[req.user.company_id,d.name,d.type,d.city,d.district,d.address,d.rent,d.commission,d.owner_id]); await audit(db,req.user,'property.created',row.id);return row;
 }));});
 app.post('/api/tenants',allow(...staff),async(req,res)=>{const d=tenantSchema.parse(req.body);res.status(201).json(await tenantTx(req.user.company_id,async db=>{
  if(d.user_id&&!(await db.query("SELECT id FROM users WHERE id=$1 AND company_id=$2 AND role='tenant'",[d.user_id,req.user.company_id])).rowCount) throw fail(400,'Compte locataire invalide.');
  const {rows:[row]}=await db.query('INSERT INTO tenants(company_id,name,email,phone,user_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.company_id,d.name,d.email,d.phone,d.user_id]);return row;
 }));});
 app.post('/api/leases',allow(...staff),async(req,res)=>{const d=leaseSchema.parse(req.body);res.status(201).json(await tenantTx(req.user.company_id,async db=>{
  const {rows:[row]}=await db.query('INSERT INTO leases(company_id,property_id,tenant_id,start_date,end_date,rent,deposit) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.user.company_id,d.property_id,d.tenant_id,d.start_date,d.end_date,d.rent,d.deposit]);await generateInvoices(db,req.user.company_id); await audit(db,req.user,'lease.created',row.id);return row;
 }));});
 app.patch('/api/leases/:id/end',allow(...staff),async(req,res)=>{await tenantTx(req.user.company_id,async db=>{await accessibleLease(db,req.user,uuid.parse(req.params.id));await db.query("UPDATE leases SET status='ended' WHERE id=$1",[req.params.id]);await audit(db,req.user,'lease.ended',req.params.id);});res.status(204).end();});
 app.post('/api/invoices/generate',allow(...staff),async(req,res)=>res.json({created:(await tenantTx(req.user.company_id,db=>generateInvoices(db,req.user.company_id))).rowCount}));
 app.get('/api/invoices/:id/receipt',async(req,res)=>{const pdf=await tenantTx(req.user.company_id,async db=>{const row=await receiptData(db,uuid.parse(req.params.id),req.user.company_id);if(!row) throw fail(404,'Quittance indisponible.');await accessibleLease(db,req.user,row.lease_id);return receiptPdf(row);});res.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="quittance.pdf"','Cache-Control':'no-store'}).send(pdf);});
 app.post('/api/tickets',allow(...staff,'tenant'),async(req,res)=>{const d=z.object({property_id:uuid,title:text,description:z.string().min(5).max(3000),priority:z.enum(['normal','urgent'])}).strict().parse(req.body); res.status(201).json(await tenantTx(req.user.company_id,async db=>{await accessibleProperty(db,req.user,d.property_id);if(req.user.role==='tenant'&&!(await db.query("SELECT l.id FROM leases l JOIN tenants t ON t.id=l.tenant_id WHERE l.property_id=$1 AND l.status='active' AND t.user_id=$2",[d.property_id,req.user.id])).rowCount) throw fail(403,'Bail actif requis.');return (await db.query('INSERT INTO tickets(company_id,property_id,title,description,priority,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.user.company_id,d.property_id,d.title,d.description,d.priority,req.user.id])).rows[0];}));});
 app.patch('/api/tickets/:id',allow(...staff),async(req,res)=>{const {status}=z.object({status:z.enum(['open','in_progress','resolved'])}).strict().parse(req.body);const row=await tenantTx(req.user.company_id,async db=>(await db.query('UPDATE tickets SET status=$1 WHERE id=$2 AND company_id=$3 RETURNING *',[status,uuid.parse(req.params.id),req.user.company_id])).rows[0]);if(!row) throw fail(404,'Demande introuvable.');res.json(row);});
 app.post('/api/users',allow('agency_admin'),async(req,res)=>{const d=z.object({name:text,email:z.string().email().transform(v=>v.toLowerCase()),password:z.string().min(12).max(128),role:z.enum(['agency_admin','manager','owner','tenant'])}).strict().parse(req.body);const {rows:[row]}=await pool.query('INSERT INTO users(company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role',[req.user.company_id,d.name,d.email,await bcrypt.hash(d.password,12),d.role]);await audit(pool,req.user,'user.created',row.id);res.status(201).json(row);});
 documentRoutes(app);
}
function documentRoutes(app) {
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:2}});
 app.post('/api/documents',allow(...staff),upload.single('file'),async(req,res)=>{
  const d=z.object({lease_id:uuid,kind:z.enum(['contract','inventory','identity'])}).strict().parse(req.body); const file=req.file;
  if(!file) throw fail(400,'Fichier manquant.');
  const b=file.buffer; const mime=b.subarray(0,5).toString()==='%PDF-'?'application/pdf':b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':null;
  if(!mime) throw fail(400,'Formats autorisés : PDF, PNG, JPEG.');
  const filename=crypto.randomUUID();const directory=path.resolve(process.env.STORAGE_DIR||'storage',req.user.company_id);
  await tenantTx(req.user.company_id,db=>accessibleLease(db,req.user,d.lease_id));await mkdir(directory,{recursive:true,mode:0o700});await writeFile(path.join(directory,filename),b,{mode:0o600,flag:'wx'});
  try {const result=await tenantTx(req.user.company_id,async db=>(await db.query('INSERT INTO documents(company_id,lease_id,name,kind,filename,mime) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,kind,lease_id',[req.user.company_id,d.lease_id,file.originalname.slice(0,200),d.kind,filename,mime])).rows[0]);res.status(201).json(result);}catch(e){await unlink(path.join(directory,filename));throw e;}
 });
 app.get('/api/documents/:id',async(req,res)=>{const doc=await tenantTx(req.user.company_id,async db=>{const {rows:[row]}=await db.query('SELECT * FROM documents WHERE id=$1 AND company_id=$2',[uuid.parse(req.params.id),req.user.company_id]);if(!row||(req.user.role==='owner'&&row.kind==='identity')) throw fail(404,'Document introuvable.');await accessibleLease(db,req.user,row.lease_id);return row;});const buffer=await readFile(path.resolve(process.env.STORAGE_DIR||'storage',req.user.company_id,doc.filename));res.set({'Content-Type':doc.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,'Cache-Control':'no-store'}).send(buffer);});
}
