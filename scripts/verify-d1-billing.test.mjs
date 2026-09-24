import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {schema,migration,alice,cfg,messages} from './billing-fixtures.mjs';
import {reserveChat,beginDispatch,settleChat,releaseChat} from '../backend/chat-billing.mjs';

function statements(){
 // Use SQLite itself to recognize complete statements, including trigger bodies.
 const parser=new DatabaseSync(':memory:');let pending='';const queries=[];
 try{
  for(const line of (schema+'\n'+migration).split('\n')){
   if(!line.trim()||line.trim().startsWith('--'))continue;
   pending+=line+'\n';if(!line.trim().endsWith(';'))continue;
   try{parser.exec(pending);}catch(error){if(String(error.message).includes('incomplete input'))continue;throw error;}
   if(!pending.trim().startsWith('PRAGMA'))queries.push(pending);pending='';
  }
  assert.equal(pending,'');return queries;
 }finally{parser.close();}
}

test('Cloudflare local D1 applies migration and atomically reserves, settles and rolls back',async()=>{
 const mf=new Miniflare({workers:[{name:'billing-test',modules:true,script:'export default {fetch(){return new Response("local test");}}',compatibilityDate:'2026-08-06',d1Databases:{DB:'local-billing-test'}}]});
 try{
  const DB=await mf.getD1Database('DB');await DB.batch(statements().map(sql=>DB.prepare(sql)));
  const now=new Date().toISOString(),start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
  await DB.batch([
   DB.prepare('INSERT INTO billing_accounts VALUES (?,?,?,?,?,?,?,?,?)').bind('alice','free','active',20,80,0,start,end,now),
   DB.prepare('INSERT INTO usage_limits VALUES (?,?,?,?,?,?,?)').bind('alice',1000,10000,100000,1000,null,now),
   DB.prepare('INSERT INTO chat_billing_policy VALUES (?,?,?,?)').bind('chat',1,100000,now),
   DB.prepare('INSERT INTO provider_price_snapshots VALUES (?,?,?,?,?,?,?,?,?)').bind('price',cfg.provider,cfg.model,1000000,1000000,10,start,null,end)
  ]);
  const env={DB};const attempts=await Promise.allSettled(Array.from({length:12},()=>reserveChat(env,alice,'same-key',messages,cfg)));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  assert.ok(attempts.filter(x=>x.status==='rejected').every(x=>x.reason.code==='REQUEST_ALREADY_EXISTS'));
  const row=attempts.find(x=>x.status==='fulfilled').value;await beginDispatch(env,alice,row);
  await Promise.all(Array.from({length:4},()=>settleChat(env,alice,row,{inputTokens:10,outputTokens:5},'provider-1')));
  const account=await DB.prepare('SELECT * FROM billing_accounts').first();assert.equal(account.included_credits,18);assert.equal(account.reserved_credits,0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE event_type='settle'").first()).n,1);
  const second=await reserveChat(env,alice,'release-key',messages,cfg);await Promise.all([releaseChat(env,alice,second),releaseChat(env,alice,second)]);
  assert.equal((await DB.prepare('SELECT reserved_credits AS n FROM billing_accounts').first()).n,0);
  await DB.prepare("CREATE TRIGGER fail_ledger BEFORE INSERT ON usage_ledger BEGIN SELECT RAISE(ABORT,'simulated failure'); END;").run();
  await assert.rejects(reserveChat(env,alice,'rollback-key',messages,cfg),e=>e.code==='BILLING_UNAVAILABLE');
  assert.equal((await DB.prepare('SELECT reserved_credits AS n FROM billing_accounts').first()).n,0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE idempotency_key='rollback-key'").first()).n,0);
 }finally{await mf.dispose();}
});
