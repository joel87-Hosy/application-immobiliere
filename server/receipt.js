import PDFDocument from 'pdfkit';
import { commissionFor } from './security.js';
export async function receiptData(db,id,companyId) {
 const {rows:[row]}=await db.query(`SELECT i.*,t.name AS tenant_name,t.email AS tenant_email,p.name AS property_name,p.address,c.name AS company_name FROM invoices i JOIN leases l ON l.id=i.lease_id JOIN tenants t ON t.id=l.tenant_id JOIN properties p ON p.id=l.property_id JOIN companies c ON c.id=i.company_id WHERE i.id=$1 AND i.company_id=$2 AND i.paid_at IS NOT NULL`,[id,companyId]);
 return row;
}
export function receiptPdf(row) {
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:55,info:{Title:`Quittance ${row.reference}`}}); const parts=[];
  doc.on('data',part=>parts.push(part)); doc.on('end',()=>resolve(Buffer.concat(parts))); doc.on('error',reject);
  const money=n=>new Intl.NumberFormat('fr-FR').format(n).replaceAll('\u202f',' ')+' FCFA';
  doc.fillColor('#143f35').fontSize(24).text(row.company_name).moveDown().fontSize(18).text('QUITTANCE DE LOYER');
  doc.moveDown().fillColor('#222222').fontSize(11).text(`Référence : ${row.reference}`).text(`Émise le : ${new Date(row.paid_at).toLocaleString('fr-FR',{timeZone:'Africa/Abidjan'})} (UTC)`);
  doc.moveDown().text(`Locataire : ${row.tenant_name}`).text(`Bien : ${row.property_name}`).text(`Adresse : ${row.address}`).text(`Période : ${new Date(row.period).toLocaleDateString('fr-FR',{month:'long',year:'numeric',timeZone:'Africa/Abidjan'})}`);
  doc.moveDown(2).fontSize(16).text(`Montant reçu : ${money(row.amount)}`).fontSize(11).moveDown().text('Paiement confirmé. La présente quittance couvre le loyer de la période indiquée.');
  doc.moveDown(3).fillColor('#777777').fontSize(9).text('Document généré électroniquement par Lagune Immo.'); doc.end();
 });
}
export { commissionFor };
