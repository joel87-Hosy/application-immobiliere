import crypto from 'node:crypto';
import { fail } from './security.js';
// CinetPay Checkout v2: concatenation in provider-defined order, NOT raw-body HMAC.
export const hmacFields=['cpm_site_id','cpm_trans_id','cpm_trans_date','cpm_amount','cpm_currency','signature','payment_method','cel_phone_num','cpm_phone_prefixe','cpm_language','cpm_version','cpm_payment_config','cpm_page_action','cpm_custom','cpm_designation','cpm_error_message'];
export function verifyCinetpay(body,token,secret) {
 if(!secret||typeof token!=='string'||! /^[0-9a-f]{64}$/i.test(token)) return false;
 if(hmacFields.some(k=>body[k]!==undefined&&typeof body[k]!=='string')) return false;
 const expected=crypto.createHmac('sha256',secret).update(hmacFields.map(k=>body[k]??'').join('')).digest();
 return crypto.timingSafeEqual(expected,Buffer.from(token,'hex'));
}
export function requireCinetpay() {
 if(!process.env.CINETPAY_API_KEY||!process.env.CINETPAY_SITE_ID||!process.env.CINETPAY_SECRET_KEY) throw fail(503,'CinetPay doit être configuré par l’administrateur.');
}
async function request(path,body) {
 requireCinetpay();
 const response=await fetch(`https://api-checkout.cinetpay.com/v2/payment${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apikey:process.env.CINETPAY_API_KEY,site_id:process.env.CINETPAY_SITE_ID,...body}),signal:AbortSignal.timeout(15000)});
 if(!response.ok) throw fail(502,'CinetPay est temporairement indisponible.');
 return response.json();
}
export async function initializePayment(payment,customer) {
 const response=await request('',{transaction_id:payment.transaction_id,amount:payment.amount,currency:'XOF',description:'Paiement du loyer',notify_url:`${process.env.APP_ORIGIN}/api/webhooks/cinetpay`,return_url:`${process.env.APP_ORIGIN}/?payment=return`,channels:'ALL',lang:'FR',customer_id:customer.id,customer_name:customer.name,customer_surname:customer.name,customer_email:customer.email,customer_phone_number:customer.phone,customer_address:customer.address||'Abidjan',customer_city:customer.city||'Abidjan',customer_country:'CI',customer_state:'CI',customer_zip_code:'00225'});
 if(response.code!=='201'||!response.data?.payment_url) throw fail(502,'Initialisation CinetPay refusée.');
 const url=new URL(response.data.payment_url);
 if(url.protocol!=='https:'||!(url.hostname==='cinetpay.com'||url.hostname.endsWith('.cinetpay.com'))) throw fail(502,'URL CinetPay invalide.');
 return url.href;
}
export const checkPayment=transaction_id=>request('/check',{transaction_id});
