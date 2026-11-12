import 'dotenv/config';
import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export async function verifyRuntimeRole() {
 const {rows:[role]}=await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
 const {rows:owned}=await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner=current_user");
 if(!role||role.rolsuper||role.rolbypassrls||owned.length) throw new Error('Le compte PostgreSQL applicatif doit être non propriétaire, sans SUPERUSER ni BYPASSRLS.');
}
export async function tenantTx(companyId, work) {
 const client = await pool.connect();
 try { await client.query('BEGIN'); await client.query("SELECT set_config('app.company_id',$1,true)",[companyId]); const result=await work(client); await client.query('COMMIT'); return result; }
 catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function audit(db,user,action,id) { await db.query('INSERT INTO audit_logs(company_id,actor_id,action,entity_id) VALUES($1,$2,$3,$4)',[user.company_id,user.id,action,id]); }
