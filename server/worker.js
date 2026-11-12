import 'dotenv/config';
import nodemailer from 'nodemailer';
import { pool,tenantTx,verifyRuntimeRole } from './db.js';
import { generateInvoices } from './routes.js';
import { checkPayment } from './cinetpay.js';
import { settlePayment } from './payments.js';
import { receiptData,receiptPdf } from './receipt.js';
const smtp=process.env.SMTP_HOST?nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT)===465,requireTLS:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},disableFileAccess:true,disableUrlAccess:true,connectionTimeout:15000,socketTimeout:30000}):null;
let stopped=false;
await verifyRuntimeRole();
async function tick(){
 const {rows:companies}=await pool.query('SELECT id,active FROM companies');
 for(const company of companies){
  try {
   if(company.active) await tenantTx(company.id,db=>generateInvoices(db,company.id));
   if(process.env.CINETPAY_API_KEY&&process.env.CINETPAY_SECRET_KEY){
    const payments=await tenantTx(company.id,async db=>(await db.query("SELECT * FROM payments WHERE status='pending' AND created_at<now()-interval '1 minute' ORDER BY created_at LIMIT 20")).rows);
    for(const payment of payments){try{const result=await checkPayment(payment.transaction_id);await tenantTx(company.id,async db=>{
     if(result.code==='00'&&result.data?.status==='ACCEPTED') await settlePayment(db,payment,result);
     else if(result.data?.status==='REFUSED') await db.query("UPDATE payments SET status='failed' WHERE id=$1 AND status='pending'",[payment.id]);
    });}catch{console.error(JSON.stringify({event:'reconciliation.retry',payment_id:payment.id}));}}
   }
   if(smtp) await tenantTx(company.id,async db=>{
    const {rows:jobs}=await db.query("SELECT * FROM mail_jobs WHERE sent_at IS NULL AND attempts<10 AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 5 FOR UPDATE SKIP LOCKED");
    for(const job of jobs){try{
     const row=await receiptData(db,job.invoice_id,company.id);if(!row) continue;
     await smtp.sendMail({from:process.env.MAIL_FROM,to:row.tenant_email,subject:`Votre quittance ${row.reference}`,messageId:`<${job.id}@lagune.local>`,text:`Bonjour ${row.tenant_name},\nVotre paiement a été confirmé. Vous trouverez votre quittance en pièce jointe.\n${row.company_name}`,attachments:[{filename:`${row.reference}.pdf`,content:await receiptPdf(row),contentType:'application/pdf'}]});
     await db.query('UPDATE mail_jobs SET sent_at=now(),attempts=attempts+1,last_error=NULL WHERE id=$1',[job.id]);
    }catch{await db.query("UPDATE mail_jobs SET attempts=attempts+1,next_attempt_at=now()+interval '15 minutes',last_error='SMTP delivery failed' WHERE id=$1",[job.id]);}}
   });
  }catch{console.error(JSON.stringify({event:'worker.company.failed',company_id:company.id}));}
 }
 await pool.query('DELETE FROM sessions WHERE expires_at<now()');
}
process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
while(!stopped){try{await tick();}catch{console.error(JSON.stringify({event:'worker.tick.failed'}));}if(!stopped)await new Promise(resolve=>setTimeout(resolve,60000));}
await pool.end();
