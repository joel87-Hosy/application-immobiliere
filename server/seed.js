import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { z } from 'zod';
const email=z.string().email().parse(process.env.SEED_ADMIN_EMAIL).toLowerCase();
const password=z.string().min(12).max(128).parse(process.env.SEED_ADMIN_PASSWORD);
try {
 const {rows:[existing]}=await pool.query("SELECT id FROM users WHERE role='saas_admin' LIMIT 1");
 if(existing) throw new Error('Un Super Admin existe déjà. Initialisation refusée.');
 await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES('Administrateur SaaS',$1,$2,'saas_admin')",[email,await bcrypt.hash(password,12)]);
 console.log('Super Admin créé. Connectez-vous pour créer votre première agence.');
}finally{await pool.end();}
