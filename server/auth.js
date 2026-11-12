import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import { fail,hashToken,signAccess,verifyAccess } from './security.js';
const options=()=>({httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api'});
function cookies(res,user,session,refresh) {
 res.cookie('access',signAccess(user,session),{...options(),maxAge:15*60*1000});
 res.cookie('refresh',refresh,{...options(),maxAge:7*86400000});
}
const publicUser=({id,name,email,role,company_id})=>({id,name,email,role,company_id});
export async function authenticate(req,res,next) {
 try {
  const token=verifyAccess(req.cookies.access);
  const {rows:[user]}=await pool.query('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id LEFT JOIN companies c ON c.id=u.company_id WHERE u.id=$1 AND s.id=$2 AND s.expires_at>now() AND (u.company_id IS NULL OR c.active=true)',[token.sub,token.sid]);
  if(!user||user.company_id!==token.company_id||user.role!==token.role) throw Error('Invalid');
  req.user=publicUser(user); next();
 } catch {next(fail(401,'Veuillez vous connecter.'));}
}
export function authRoutes(app) {
 const limiter=rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Trop de tentatives. Réessayez dans 15 minutes.'}});
 app.post('/api/auth/login',limiter,async(req,res)=>{
  const {email,password}=z.object({email:z.string().email().transform(v=>v.toLowerCase()),password:z.string().min(1).max(128)}).strict().parse(req.body);
  const {rows:[user]}=await pool.query('SELECT u.* FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.email=$1 AND (u.company_id IS NULL OR c.active=true)',[email]);
  // Equal-cost password check also for unknown accounts.
  const valid=await bcrypt.compare(password,user?.password_hash??'$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
  if(!user||!valid) throw fail(401,'Identifiants incorrects.');
  const refresh=crypto.randomBytes(48).toString('hex');
  const {rows:[session]}=await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days') RETURNING id",[user.id,hashToken(refresh)]);
  cookies(res,user,session.id,refresh); res.json(publicUser(user));
 });
 app.post('/api/auth/refresh',limiter,async(req,res)=>{
  if(!req.cookies.refresh) throw fail(401,'Session expirée.');
  const nextToken=crypto.randomBytes(48).toString('hex');
  const {rows:[session]}=await pool.query("UPDATE sessions SET token_hash=$1 WHERE token_hash=$2 AND expires_at>now() RETURNING id,user_id",[hashToken(nextToken),hashToken(req.cookies.refresh)]);
  if(!session) throw fail(401,'Session expirée.');
  const {rows:[user]}=await pool.query('SELECT u.* FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.id=$1 AND (u.company_id IS NULL OR c.active=true)',[session.user_id]);
  if(!user) throw fail(401,'Compte indisponible.');
  cookies(res,user,session.id,nextToken); res.json(publicUser(user));
 });
 app.post('/api/auth/logout',async(req,res)=>{
  if(req.cookies.refresh) await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hashToken(req.cookies.refresh)]);
  res.clearCookie('access',options()); res.clearCookie('refresh',options()); res.status(204).end();
 });
 app.get('/api/auth/me',authenticate,(req,res)=>res.json(req.user));
}
