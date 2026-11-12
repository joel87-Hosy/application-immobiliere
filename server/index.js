import { createApp } from './app.js';
import { verifyRuntimeRole } from './db.js';
if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32||process.env.JWT_SECRET.startsWith('REPLACE')) throw new Error('Configurez JWT_SECRET (32 caractères aléatoires minimum).');
if(!process.env.DATABASE_URL||!process.env.APP_ORIGIN) throw new Error('DATABASE_URL et APP_ORIGIN sont obligatoires.');
if(process.env.NODE_ENV==='production'&&!process.env.APP_ORIGIN.startsWith('https://')) throw new Error('HTTPS obligatoire en production.');
await verifyRuntimeRole();
const app=createApp();app.listen(Number(process.env.PORT||3001),'127.0.0.1',()=>console.log(`API Lagune Immo : http://127.0.0.1:${process.env.PORT||3001}`));
