import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
export const roles=['saas_admin','agency_admin','manager','owner','tenant'];
export const staff=['agency_admin','manager'];
export const uuid=z.string().uuid();
export function fail(status,message) { return Object.assign(new Error(message),{status}); }
export function rejectTenantInput(req,res,next) {
 const has=(value)=>value && typeof value==='object' && Object.entries(value).some(([k,v])=>k==='company_id'||k==='companyId'||has(v));
 if(has(req.body)||has(req.query)) return next(fail(400,'L’agence est déterminée par la session, jamais par la requête.'));
 next();
}
export function sameOrigin(req,res,next) {
 if(['GET','HEAD','OPTIONS'].includes(req.method)) return next();
 if(req.headers.origin!==process.env.APP_ORIGIN || req.headers['sec-fetch-site']==='cross-site') return next(fail(403,'Origine non autorisée.'));
 next();
}
export const hashToken=(value)=>crypto.createHash('sha256').update(value).digest('hex');
export function signAccess(user,sessionId) {return jwt.sign({sub:user.id,company_id:user.company_id,role:user.role,sid:sessionId},process.env.JWT_SECRET,{expiresIn:'15m',algorithm:'HS256',issuer:'lagune-immo',audience:'lagune-web'});}
export function verifyAccess(token) {return jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256'],issuer:'lagune-immo',audience:'lagune-web'});}
export function allow(...allowed) {return(req,res,next)=>allowed.includes(req.user.role)?next():next(fail(403,'Accès non autorisé.'));}
export const commissionFor=(amount,rate)=>Math.round(amount*Number(rate)/100);
