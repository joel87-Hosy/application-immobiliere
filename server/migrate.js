import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});
if(!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL obligatoire');
await db.connect();
try { await db.query('BEGIN'); await db.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8')); await db.query('COMMIT'); console.log('Schéma PostgreSQL installé.'); } catch(e) { await db.query('ROLLBACK'); throw e; } finally {await db.end();}
