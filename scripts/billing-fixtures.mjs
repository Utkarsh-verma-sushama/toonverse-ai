import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export const schema=readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8');
export const migration=readFileSync(new URL('../backend/migrations/0001_atomic_chat_billing.sql',import.meta.url),'utf8');
export const abuseMigration=readFileSync(new URL('../backend/migrations/0003_abuse_spend_hardening.sql',import.meta.url),'utf8');
export const alice={sub:'alice',verified:true};
export const cfg={provider:'test-gateway',model:'test-text',maxInputTokens:100,maxOutputTokens:50,globalCeiling:100000};
export const messages=[{role:'user',content:'Hello'}];
export function d1(sql,{beforeRun,afterRun}={}) {
 return {prepare(query){let values=[];return {get query(){return query;},get values(){return values;},bind(...args){values=args;return this;},async first(){await Promise.resolve();return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){await Promise.resolve();beforeRun?.(query,values);const out=sql.prepare(query).run(...values);afterRun?.(query,values);return {success:true,meta:{changes:Number(out.changes)}};}};},
 async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>{beforeRun?.(s.query,s.values);const out=sql.prepare(s.query).run(...s.values);afterRun?.(s.query,s.values);return {success:true,meta:{changes:Number(out.changes)}};});sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
}
export function seedUser(sql,uid='alice',included=20,prepaid=80){
 const start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+29*86400000).toISOString();
 sql.prepare('INSERT INTO billing_accounts VALUES (?,?,?,?,?,?,?,?,?)').run(uid,'free','active',included,prepaid,0,start,end,start);
 const columns=sql.prepare("PRAGMA table_info(usage_limits)").all().map(row=>row.name);
 if(columns.includes('max_concurrent_requests')){
  sql.prepare('INSERT INTO usage_limits (owner_id,daily_credit_limit,monthly_credit_limit,max_request_cost_microusd,requests_per_minute,blocked_until,updated_at,max_concurrent_requests,hourly_cost_limit_microusd) VALUES (?,?,?,?,?,?,?,?,?)').run(uid,1000,10000,100000,1000,null,start,2,100000);
 }else{
  // Legacy-schema fixture: seed only columns that existed before abuse/spend hardening.
  sql.prepare('INSERT INTO usage_limits (owner_id,daily_credit_limit,monthly_credit_limit,max_request_cost_microusd,requests_per_minute,blocked_until,updated_at) VALUES (?,?,?,?,?,?,?)').run(uid,1000,10000,100000,1000,null,start);
 }
}
export function fixture(path=':memory:') {
 const sql=new DatabaseSync(path);sql.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;');sql.exec(schema);
 sql.exec('BEGIN;'+migration+abuseMigration+'COMMIT;');
 seedUser(sql);
 sql.prepare('INSERT INTO chat_billing_policy VALUES (?,?,?,?)').run('chat',1,100000,new Date().toISOString());
 sql.prepare('INSERT INTO provider_price_snapshots (id,provider,model,input_microusd_per_million,output_microusd_per_million,credit_value_microusd,effective_at,retired_at,valid_until) VALUES (?,?,?,?,?,?,?,?,?)')
  .run('price-1',cfg.provider,cfg.model,1000000,1000000,10,new Date(Date.now()-86400000).toISOString(),null,new Date(Date.now()+86400000).toISOString());
 return {sql,DB:d1(sql)};
}
export function balance(db,uid='alice'){return db.sql.prepare('SELECT included_credits AS included,prepaid_credits AS prepaid,reserved_credits AS reserved FROM billing_accounts WHERE owner_id=?').get(uid);}
export function invariant(db){
 for(const a of db.sql.prepare('SELECT * FROM billing_accounts').all()){
  const held=db.sql.prepare("SELECT COALESCE(SUM(estimated_credits),0) AS held FROM usage_reservations WHERE owner_id=? AND status='reserved'").get(a.owner_id).held;
  if(a.reserved_credits!==held||a.included_credits<0||a.prepaid_credits<0||a.reserved_credits>a.included_credits+a.prepaid_credits)throw new Error('Broken billing invariant');
 }
}
