import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { sameOrigin,rejectTenantInput } from './security.js';
import { authRoutes,authenticate } from './auth.js';
import { adminRoutes,agencyRoutes } from './routes.js';
import { webhookRoutes,paymentRoutes } from './payments.js';
export function createApp() {
 const app=express(); app.disable('x-powered-by');app.set('trust proxy','loopback');
 app.use(helmet({contentSecurityPolicy:{directives:{'img-src':["'self'",'data:'],'style-src':["'self'","'unsafe-inline'"],'script-src':["'self'"]}}}));
 app.use('/api',rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false}));
 app.use(express.json({limit:'100kb'}),express.urlencoded({extended:false,limit:'32kb'}),cookieParser());
 app.get('/api/health',(req,res)=>res.json({status:'ok'}));
 webhookRoutes(app);
 app.use('/api',sameOrigin,rejectTenantInput,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 authRoutes(app);app.use('/api',authenticate);adminRoutes(app);paymentRoutes(app);agencyRoutes(app);
 app.use('/api',(req,res)=>res.status(404).json({error:'Route introuvable.'}));
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
 app.use(express.static(root));app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'index.html')));
 app.use((error,req,res,next)=>{
  if(res.headersSent) return next(error);
  if(error instanceof ZodError) return res.status(400).json({error:'Données invalides.',details:error.issues.map(v=>({field:v.path.join('.'),message:v.message}))});
  if(error.code==='23505') return res.status(409).json({error:'Cet enregistrement existe déjà ou un bail actif occupe ce bien.'});
  if(['23503','23514','22P02'].includes(error.code)) return res.status(400).json({error:'Référence ou valeur invalide pour cette agence.'});
  if(error.code==='LIMIT_FILE_SIZE') return res.status(413).json({error:'Le fichier dépasse 10 Mo.'});
  if(!error.status||error.status>=500) console.error(JSON.stringify({event:'request.error',path:req.path,code:error.code||'internal',time:new Date().toISOString()}));
  res.status(error.status||500).json({error:error.status?error.message:'Erreur serveur. Veuillez réessayer.'});
 });return app;
}
