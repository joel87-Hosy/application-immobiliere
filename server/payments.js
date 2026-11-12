import crypto from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool,tenantTx,audit } from './db.js';
import { fail,uuid,allow } from './security.js';
import { requireCinetpay,verifyCinetpay,initializePayment,checkPayment } from './cinetpay.js';
export async function settlePayment(db,payment,verified) {
 if(verified.code!=='00'||verified.data?.status!=='ACCEPTED') return false;
 if(Number(verified.data.amount)!==payment.amount||verified.data.currency!=='XOF') throw fail(400,'Montant ou devise incohérents.');
 const {rows:[invoice]}=await db.query('SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE',[payment.invoice_id,payment.company_id]);
 if(!invoice) throw fail(404,'Échéance introuvable.');
 const {rowCount}=await db.query("UPDATE payments SET status='accepted' WHERE id=$1 AND status='pending' RETURNING id",[payment.id]);
 if(!rowCount) return false;
 await db.query('UPDATE invoices SET paid_at=COALESCE(paid_at,now()) WHERE id=$1',[invoice.id]);
 await db.query('INSERT INTO mail_jobs(company_id,invoice_id) VALUES($1,$2) ON CONFLICT(invoice_id) DO NOTHING',[payment.company_id,invoice.id]);
 await audit(db,{company_id:payment.company_id,id:null},'payment.accepted',payment.id); return true;
}
export function webhookRoutes(app) {
 app.get('/api/webhooks/cinetpay',(req,res)=>res.status(200).json({message:'Notification POST signée requise.'}));
 app.post('/api/webhooks/cinetpay',rateLimit({windowMs:60000,limit:120}),async(req,res)=>{
  requireCinetpay();
  if(!verifyCinetpay(req.body,req.get('x-token'),process.env.CINETPAY_SECRET_KEY)) throw fail(401,'Signature invalide.');
  if(req.body.cpm_site_id!==process.env.CINETPAY_SITE_ID) throw fail(400,'Site marchand invalide.');
  const transaction=z.string().regex(/^[a-f0-9]{32}$/).parse(req.body.cpm_trans_id);
  // Discover tenant from trusted provider transaction, not from caller-supplied agency fields.
  const {rows:companies}=await pool.query('SELECT id FROM companies');
  let payment;
  for(const company of companies) {
   payment=await tenantTx(company.id,async db=>(await db.query('SELECT * FROM payments WHERE transaction_id=$1',[transaction])).rows[0]);
   if(payment) break;
  }
  if(!payment) throw fail(404,'Transaction inconnue.');
  const verified=await checkPayment(transaction);
  await tenantTx(payment.company_id,db=>settlePayment(db,payment,verified));
  res.json({received:true});
 });
}
export function paymentRoutes(app) {
 app.post('/api/payments',allow('tenant','manager','agency_admin'),rateLimit({windowMs:60000,limit:10}),async(req,res)=>{
  requireCinetpay(); const {invoice_id}=z.object({invoice_id:uuid}).strict().parse(req.body);
  const result=await tenantTx(req.user.company_id,async db=>{
   const {rows:[invoice]}=await db.query(`SELECT i.*,t.id AS customer_id,t.name,t.email,t.phone,t.user_id,p.address,p.city FROM invoices i JOIN leases l ON l.id=i.lease_id JOIN tenants t ON t.id=l.tenant_id JOIN properties p ON p.id=l.property_id WHERE i.id=$1 AND i.company_id=$2 FOR UPDATE OF i`,[invoice_id,req.user.company_id]);
   if(!invoice||(req.user.role==='tenant'&&invoice.user_id!==req.user.id)) throw fail(404,'Échéance introuvable.');
   if(invoice.paid_at) throw fail(409,'Ce loyer est déjà réglé.');
   const {rows:[existing]}=await db.query("SELECT * FROM payments WHERE invoice_id=$1 AND status IN ('pending','accepted')",[invoice_id]);
   if(existing) { if(existing.payment_url) return {payment:existing,existing:true}; throw fail(409,'Une transaction est en cours de vérification.'); }
   const {rows:[payment]}=await db.query('INSERT INTO payments(company_id,invoice_id,transaction_id,amount) VALUES($1,$2,$3,$4) RETURNING *',[req.user.company_id,invoice.id,crypto.randomBytes(16).toString('hex'),invoice.amount]);
   return {payment,customer:{...invoice,id:invoice.customer_id}};
  });
  if(result.existing) return res.json({url:result.payment.payment_url});
  // Persist transaction before network request. Ambiguous errors remain pending for reconciliation.
  const url=await initializePayment(result.payment,result.customer);
  await tenantTx(req.user.company_id,db=>db.query('UPDATE payments SET payment_url=$1 WHERE id=$2',[url,result.payment.id]));
  res.json({url});
 });
}
