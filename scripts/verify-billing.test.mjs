import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {reserveChat,beginDispatch,settleChat,releaseChat,markUnknown,getChatReceipt,expireUndispatched,usageCost} from '../backend/chat-billing.mjs';
import {fixture,balance,invariant,d1,seedUser,schema,migration,abuseMigration,alice,cfg,messages} from './billing-fixtures.mjs';
const fails=code=>error=>error.code===code;
async function reserved(db,key='key-1',user=alice,options=cfg){return reserveChat(db,user,key,messages,options);}
async function billed(db,key='key-1',usage={inputTokens:100,outputTokens:50}){const row=await reserved(db,key);await beginDispatch(db,alice,row);return settleChat(db,alice,row,usage,'provider-'+key);}
function done(db){invariant(db);db.sql.close();}

test('reserves the complete input/output ceiling and atomically writes the hold ledger',async()=>{
 const db=fixture();try{const row=await reserved(db);assert.equal(row.estimated_credits,15);assert.equal(row.estimated_cost_microusd,150);
 assert.deepEqual({...balance(db)},{included:20,prepaid:80,reserved:15});
 assert.equal(db.sql.prepare('SELECT SUM(credits) AS n FROM usage_ledger').get().n,15);
 }finally{done(db);}
});
test('settles exact provider usage, releases unused hold and charges included credits first',async()=>{
 const db=fixture();try{const value=await billed(db,'key-1',{inputTokens:10,outputTokens:5});assert.equal(value.credits,2);
 assert.deepEqual({...balance(db)},{included:18,prepaid:80,reserved:0});
 const ledger=JSON.parse(db.sql.prepare("SELECT metadata_json FROM usage_ledger WHERE event_type='settle'").get().metadata_json);
 assert.equal(ledger.unusedCredits,13);assert.equal(ledger.includedCharged,2);assert.equal(ledger.prepaidCharged,0);
 }finally{done(db);}
});
test('prepaid credits cover only the remainder after included credits',async()=>{
 const db=fixture();try{db.sql.exec('UPDATE billing_accounts SET included_credits=2');await billed(db);assert.deepEqual({...balance(db)},{included:0,prepaid:67,reserved:0});
 const rows=db.sql.prepare("SELECT event_type,credits FROM usage_ledger WHERE event_type LIKE 'reserve_%' ORDER BY event_type").all();
 assert.deepEqual(rows.map(x=>[x.event_type,x.credits]),[['reserve_included',2],['reserve_prepaid',13]]);
 }finally{done(db);}
});
test('concurrent duplicate keys reserve once, while different payloads conflict',async()=>{
 const db=fixture();try{
 const results=await Promise.allSettled(Array.from({length:25},()=>reserved(db)));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM usage_reservations').get().n,1);
 assert.equal(balance(db).reserved,15);assert.ok(results.filter(x=>x.status==='rejected').every(x=>x.reason.code==='REQUEST_ALREADY_EXISTS'));
 await assert.rejects(reserveChat(db,alice,'key-1',[{role:'user',content:'Different'}],cfg),fails('IDEMPOTENCY_CONFLICT'));
 }finally{done(db);}
});
test('concurrent distinct requests cannot overdraw available credits',async()=>{
 const db=fixture();try{db.sql.exec('UPDATE usage_limits SET max_concurrent_requests=16');
 const results=await Promise.allSettled(Array.from({length:20},(_,i)=>reserved(db,'key-'+i)));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,6);assert.equal(balance(db).reserved,90);
 assert.ok(results.filter(x=>x.status==='rejected').every(x=>x.reason.code==='INSUFFICIENT_CREDITS'));
 }finally{done(db);}
});
for(const [name,query,code] of [
 ['daily quota','UPDATE usage_limits SET daily_credit_limit=15','DAILY_QUOTA_REACHED'],
 ['monthly quota','UPDATE usage_limits SET monthly_credit_limit=15','MONTHLY_QUOTA_REACHED'],
 ['rate limit','UPDATE usage_limits SET requests_per_minute=1','RATE_LIMIT_REACHED'],
 ['global budget','UPDATE chat_billing_policy SET global_daily_cost_microusd=150','GLOBAL_SPEND_CEILING_REACHED']
])test(`${name} includes concurrent in-flight reservations`,async()=>{
 const db=fixture();try{db.sql.exec(query);const results=await Promise.allSettled([reserved(db,'one'),reserved(db,'two')]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,code);
 }finally{done(db);}
});
test('concurrency guard blocks parallel expensive work before another hold is created',async()=>{
 const db=fixture();try{db.sql.exec('UPDATE usage_limits SET max_concurrent_requests=1');await reserved(db,'one');
 await assert.rejects(reserved(db,'two'),fails('CONCURRENCY_LIMIT_REACHED'));
 assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE status='reserved'").get().n,1);assert.equal(balance(db).reserved,15);
 }finally{done(db);}
});
test('hourly spend velocity includes settled usage and open reservations',async()=>{
 const db=fixture();try{db.sql.exec('UPDATE usage_limits SET hourly_cost_limit_microusd=160');
 await billed(db,'first',{inputTokens:10,outputTokens:5});
 await assert.rejects(reserved(db,'second'),fails('HOURLY_SPEND_LIMIT_REACHED'));
 assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations").get().n,1);
 }finally{done(db);}
});
test('global budget applies across users',async()=>{
 const db=fixture();try{seedUser(db.sql,'bob');db.sql.exec('UPDATE chat_billing_policy SET global_daily_cost_microusd=150');
 const results=await Promise.allSettled([reserved(db,'one'),reserved(db,'two',{sub:'bob',verified:true})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.find(x=>x.status==='rejected').reason.code,'GLOBAL_SPEND_CEILING_REACHED');
 }finally{done(db);}
});
test('environment global ceiling cannot increase the authoritative database ceiling',async()=>{
 const db=fixture();try{db.sql.exec('UPDATE chat_billing_policy SET global_daily_cost_microusd=149');
 await assert.rejects(reserved(db),fails('GLOBAL_SPEND_CEILING_REACHED'));assert.equal(balance(db).reserved,0);
 }finally{done(db);}
});
for(const [name,query,code] of [
 ['billing switch',"UPDATE chat_billing_policy SET enabled=0",'BILLING_DISABLED'],
 ['paused account',"UPDATE billing_accounts SET status='paused'",'ACTIVE_SUBSCRIPTION_REQUIRED'],
 ['expired cycle',"UPDATE billing_accounts SET cycle_ends_at='2000-01-01T00:00:00Z'",'ACTIVE_SUBSCRIPTION_REQUIRED'],
 ['future cycle',"UPDATE billing_accounts SET cycle_started_at='2099-01-01T00:00:00Z'",'ACTIVE_SUBSCRIPTION_REQUIRED'],
 ['missing limits',"DELETE FROM usage_limits",'USAGE_LIMITS_REQUIRED'],
 ['per-request cap',"UPDATE usage_limits SET max_request_cost_microusd=149",'REQUEST_COST_LIMIT_EXCEEDED'],
 ['blocked account',"UPDATE usage_limits SET blocked_until='2099-01-01T00:00:00Z'",'USAGE_TEMPORARILY_BLOCKED'],
 ['malformed block time',"UPDATE usage_limits SET blocked_until='invalid'",'USAGE_TEMPORARILY_BLOCKED']
])test(`${name} fails before creating a hold`,async()=>{
 const db=fixture();try{db.sql.exec(query);await assert.rejects(reserved(db),fails(code));assert.equal(balance(db).reserved,0);assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM usage_ledger').get().n,0);
 }finally{done(db);}
});
test('expired, retired or future pricing snapshots cannot authorize new calls',async()=>{
 for(const type of ['expired','retired','future']){const db=fixture();try{
 db.sql.exec("UPDATE provider_price_snapshots SET retired_at=datetime('now')");
 if(type!=='retired')db.sql.prepare('INSERT INTO provider_price_snapshots VALUES (?,?,?,?,?,?,?,?,?)').run('new',cfg.provider,cfg.model,1000000,1000000,10,type==='future'?'2099-01-01':'2000-01-01',null,type==='expired'?'2001-01-01':'2100-01-01');
 await assert.rejects(reserved(db),fails('PRICE_SNAPSHOT_REQUIRED'));
 }finally{done(db);}}
});
test('settlement uses its immutable original quote after that quote is retired',async()=>{
 const db=fixture();try{const row=await reserved(db);await beginDispatch(db,alice,row);db.sql.exec("UPDATE provider_price_snapshots SET retired_at=datetime('now')");
 const value=await settleChat(db,alice,row,{inputTokens:10,outputTokens:5},'provider-1');assert.equal(value.credits,2);
 assert.throws(()=>db.sql.exec('UPDATE provider_price_snapshots SET input_microusd_per_million=1'),/PRICE_SNAPSHOT_IMMUTABLE/);
 }finally{done(db);}
});
test('repeated and concurrent settlement charges only once',async()=>{
 const db=fixture();try{const row=await reserved(db);await beginDispatch(db,alice,row);
 const results=await Promise.all(Array.from({length:10},()=>settleChat(db,alice,row,{inputTokens:10,outputTokens:5},'provider-1')));
 assert.ok(results.every(x=>x.credits===2));assert.equal(balance(db).included,18);
 assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE event_type='settle'").get().n,1);
 await assert.rejects(settleChat(db,alice,row,{inputTokens:20,outputTokens:5},'provider-1'),fails('RESERVATION_FINALIZED'));
 }finally{done(db);}
});
test('multiple concurrent settlements consume included then prepaid without dropping a debit',async()=>{
 const db=fixture();try{db.sql.exec('UPDATE usage_limits SET max_concurrent_requests=16');const rows=await Promise.all(Array.from({length:6},(_,i)=>reserved(db,'k'+i)));
 await Promise.all(rows.map(row=>beginDispatch(db,alice,row)));
 await Promise.all(rows.map(row=>settleChat(db,alice,row,{inputTokens:100,outputTokens:50},'p'+row.id)));
 assert.deepEqual({...balance(db)},{included:0,prepaid:10,reserved:0});
 }finally{done(db);}
});
test('release is idempotent and cannot undo a settled request',async()=>{
 const db=fixture();try{const row=await reserved(db);await Promise.all([releaseChat(db,alice,row),releaseChat(db,alice,row)]);
 assert.deepEqual({...balance(db)},{included:20,prepaid:80,reserved:0});assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE event_type='release'").get().n,1);
 const other=await reserved(db,'other');await beginDispatch(db,alice,other);await settleChat(db,alice,other,{inputTokens:10,outputTokens:5},'p');
 await assert.rejects(releaseChat(db,alice,other,{confirmedNotBilled:true,providerRequestId:'p'}),fails('RECONCILIATION_REQUIRED'));
 assert.equal(balance(db).included,18);
 }finally{done(db);}
});
test('uncertain provider work remains held until explicit reconciliation evidence',async()=>{
 const db=fixture();try{const row=await reserved(db);await beginDispatch(db,alice,row);await markUnknown(db,alice,row);
 await assert.rejects(releaseChat(db,alice,row),fails('RECONCILIATION_REQUIRED'));assert.equal(balance(db).reserved,15);
 const value=await settleChat(db,alice,row,{inputTokens:10,outputTokens:5},'verified-provider-record');assert.equal(value.credits,2);
 }finally{done(db);}
});
test('confirmed zero-cost rejection releases credits after dispatch',async()=>{
 const db=fixture();try{const row=await reserved(db);await beginDispatch(db,alice,row);await releaseChat(db,alice,row,{confirmedNotBilled:true,providerRequestId:'provider-no-charge'});
 assert.deepEqual({...balance(db)},{included:20,prepaid:80,reserved:0});
 }finally{done(db);}
});
test('database rejects a post-dispatch release without explicit no-charge evidence fields',async()=>{
 const db=fixture();try{const row=await reserved(db);await beginDispatch(db,alice,row);
 const release=db.sql.prepare(`UPDATE usage_reservations SET status='released',provider_state='finished',actual_credits=0,
  actual_cost_microusd=0,input_tokens=0,output_tokens=0,provider_request_id=?,failure_code=?,settled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`);
 for(const [providerId,reason] of [['p',null],['','CONFIRMED_NOT_BILLED'],[null,'CONFIRMED_NOT_BILLED']])
  assert.throws(()=>release.run(providerId,reason,row.id),/RECONCILIATION_REQUIRED/);
 assert.equal(balance(db).reserved,15);
 }finally{done(db);}
});
test('another user cannot settle, release or inspect a reservation',async()=>{
 const db=fixture();try{seedUser(db.sql,'bob');const row=await reserved(db);await beginDispatch(db,alice,row);const bob={sub:'bob',verified:true};
 await assert.rejects(settleChat(db,bob,row,{inputTokens:10,outputTokens:5},'p'),fails('RESERVATION_NOT_FOUND'));
 await assert.rejects(releaseChat(db,bob,row,{confirmedNotBilled:true,providerRequestId:'p'}),fails('RESERVATION_NOT_FOUND'));
 await assert.rejects(getChatReceipt(db,bob,'key-1'),fails('RESERVATION_NOT_FOUND'));assert.equal(balance(db).reserved,15);
 }finally{done(db);}
});
for(const usage of [{inputTokens:101,outputTokens:1},{inputTokens:1,outputTokens:51},{inputTokens:-1,outputTokens:1},{inputTokens:'10',outputTokens:1},{inputTokens:1.5,outputTokens:1},{outputTokens:1}])test(`rejects invalid usage ${JSON.stringify(usage)} without releasing held credits`,async()=>{
 const db=fixture();try{const row=await reserved(db);await beginDispatch(db,alice,row);await assert.rejects(settleChat(db,alice,row,usage,'p'),fails('INVALID_PROVIDER_USAGE'));assert.equal(balance(db).reserved,15);
 }finally{done(db);}
});
test('ledger write failure rolls back reservation and balance together',async()=>{
 const db=fixture();try{db.sql.exec("CREATE TRIGGER fail_ledger BEFORE INSERT ON usage_ledger BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
 await assert.rejects(reserved(db),fails('BILLING_UNAVAILABLE'));assert.equal(balance(db).reserved,0);assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM usage_reservations').get().n,0);
 }finally{done(db);}
});
test('settlement ledger failure leaves the original hold, not a partial debit',async()=>{
 const db=fixture();try{const row=await reserved(db);await beginDispatch(db,alice,row);
 db.sql.exec("CREATE TRIGGER fail_settle BEFORE INSERT ON usage_ledger WHEN NEW.event_type='settle' BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
 await assert.rejects(settleChat(db,alice,row,{inputTokens:10,outputTokens:5},'p'),fails('BILLING_UNAVAILABLE'));
 assert.deepEqual({...balance(db)},{included:20,prepaid:80,reserved:15});assert.equal((await getChatReceipt(db,alice,'key-1')).status,'reserved');
 }finally{done(db);}
});
test('lost reservation acknowledgement cannot create a second hold',async()=>{
 const db=fixture();try{let lost=false;const env={DB:d1(db.sql,{afterRun(query){if(query.startsWith('INSERT INTO usage_reservations')&&!lost){lost=true;throw new Error('lost response');}}})};
 await assert.rejects(reserveChat(env,alice,'key-1',messages,cfg),fails('REQUEST_ALREADY_EXISTS'));
 assert.equal(balance(db).reserved,15);assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM usage_reservations').get().n,1);
 }finally{done(db);}
});
test('ledger and reservation deletion/mutation are blocked',async()=>{
 const db=fixture();try{await reserved(db);assert.throws(()=>db.sql.exec('DELETE FROM usage_ledger'),/LEDGER_IMMUTABLE/);assert.throws(()=>db.sql.exec('UPDATE usage_ledger SET credits=0'),/LEDGER_IMMUTABLE/);
 assert.throws(()=>db.sql.exec('DELETE FROM usage_reservations'),/RESERVATION_IMMUTABLE/);assert.throws(()=>db.sql.exec('UPDATE usage_reservations SET estimated_credits=1'),/RESERVATION_IMMUTABLE/);
 }finally{done(db);}
});
test('a billing-cycle reset cannot wipe active holds',async()=>{
 const db=fixture();try{await reserved(db);assert.throws(()=>db.sql.exec("UPDATE billing_accounts SET cycle_started_at=datetime('now')"),/PENDING_RESERVATIONS/);
 assert.throws(()=>db.sql.exec('UPDATE billing_accounts SET included_credits=0,prepaid_credits=0'),/BILLING_BALANCE_INVALID/);
 }finally{done(db);}
});
test('billing kill switch is checked again immediately before dispatch',async()=>{
 const db=fixture();try{const row=await reserved(db);db.sql.exec('UPDATE chat_billing_policy SET enabled=0');await assert.rejects(beginDispatch(db,alice,row),fails('DISPATCH_NOT_ALLOWED'));
 await releaseChat(db,alice,row);assert.equal(balance(db).reserved,0);
 }finally{done(db);}
});
test('integer arithmetic rounds money and credits up without floating point drift',()=>{
 assert.deepEqual(usageCost(1,1,{inputRate:1,outputRate:1,creditValue:10}),{cost:1,credits:1});
 assert.deepEqual(usageCost(12000,8000,{inputRate:1e9,outputRate:1e9,creditValue:7}),{cost:20000000,credits:2857143});
 assert.deepEqual(usageCost(0,0,{inputRate:100,outputRate:100,creditValue:10}),{cost:0,credits:0});
});
test('missing migration fails closed',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(schema);try{await assert.rejects(reserveChat({DB:d1(sql)},alice,'key',messages,cfg),fails('BILLING_NOT_READY'));}finally{sql.close();}
});
test('legacy holds survive migration and count against available credits',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(schema);seedUser(sql);const date=new Date(Date.now()-3*86400000).toISOString();
 sql.prepare('INSERT INTO usage_reservations (id,owner_id,idempotency_key,feature,estimated_credits,estimated_cost_microusd,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run('legacy','alice','old-key','chat',90,900,'reserved',date);
 sql.exec('UPDATE billing_accounts SET reserved_credits=90');sql.exec('BEGIN;'+migration+abuseMigration+'COMMIT;');
 const db={sql,DB:d1(sql)};try{sql.prepare('INSERT INTO chat_billing_policy VALUES (?,?,?,?)').run('chat',1,100000,date);
 sql.prepare('INSERT INTO provider_price_snapshots VALUES (?,?,?,?,?,?,?,?,?)').run('price',cfg.provider,cfg.model,1000000,1000000,10,date,null,'2099-01-01');
 await assert.rejects(reserved(db),fails('INSUFFICIENT_CREDITS'));assert.equal(balance(db).reserved,90);
 }finally{done(db);}
});

test('separate concurrent database connections obey credits and idempotency atomically',async()=>{
 const {Worker}=await import('node:worker_threads');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 for(const duplicate of [false,true]){
  const dir=await mkdtemp(join(tmpdir(),'uvenaro-billing-')),file=join(dir,'test.db'),db=fixture(file),barrier=new SharedArrayBuffer(4);
  db.sql.exec('UPDATE usage_limits SET max_concurrent_requests=16');
  const workers=[],ready=[],finished=[];
  try{
   for(let index=0;index<4;index++){
    const w=new Worker(new URL('./billing-concurrency-worker.mjs',import.meta.url),{workerData:{file,index,duplicate,barrier}});workers.push(w);
    ready.push(new Promise((resolve,reject)=>{w.on('message',m=>{if(m.ready)resolve();});w.once('error',reject);}));
    finished.push(new Promise((resolve,reject)=>{w.on('message',m=>{if(m.outcomes)resolve(m.outcomes);});w.once('error',reject);w.once('exit',code=>{if(code!==0)reject(new Error('worker failed'));});}));
   }
   await Promise.all(ready);Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0);
   const results=(await Promise.all(finished)).flat();assert.equal(results.filter(x=>x==='accepted').length,duplicate?1:6);
   assert.ok(results.every(x=>['accepted',duplicate?'REQUEST_ALREADY_EXISTS':'INSUFFICIENT_CREDITS'].includes(x)));
   assert.equal(balance(db).reserved,duplicate?15:90);invariant(db);
  }finally{await Promise.all(workers.map(w=>w.terminate()));db.sql.close();await rm(dir,{recursive:true,force:true});}
 }
});

test('expiry sweep releases only never-dispatched holds, preserving started and unknown work',async()=>{
 const db=fixture();try{db.sql.exec('UPDATE usage_limits SET max_concurrent_requests=16');
  const row=await reserved(db,'original');
  const copy=db.sql.prepare(`INSERT INTO usage_reservations
   (id,owner_id,idempotency_key,feature,estimated_credits,estimated_cost_microusd,status,created_at,request_hash,price_snapshot_id,input_token_limit,output_token_limit,global_cost_ceiling,expires_at)
   SELECT ?,owner_id,?,feature,estimated_credits,estimated_cost_microusd,status,created_at,request_hash,price_snapshot_id,input_token_limit,output_token_limit,global_cost_ceiling,
    strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 second') FROM usage_reservations WHERE id=?`);
  for(const key of ['unstarted','started','unknown'])copy.run(key,key,row.id);
  await beginDispatch(db,alice,{id:'started'});await beginDispatch(db,alice,{id:'unknown'});await markUnknown(db,alice,{id:'unknown'});
  await delay(1200);await expireUndispatched(db);
  assert.equal((await getChatReceipt(db,alice,'unstarted')).status,'released');
  assert.equal((await getChatReceipt(db,alice,'started')).status,'reserved');
  assert.equal((await getChatReceipt(db,alice,'unknown')).status,'reserved');
  assert.equal(balance(db).reserved,45);await expireUndispatched(db);assert.equal(balance(db).reserved,45);
 }finally{done(db);}
});

test('legacy inconsistent hold counters block all new reservations until reconciled',async()=>{
 const db=fixture();try{db.sql.exec('UPDATE billing_accounts SET reserved_credits=1');
  await assert.rejects(reserved(db),fails('BILLING_RECONCILIATION_REQUIRED'));db.sql.exec('UPDATE billing_accounts SET reserved_credits=0');
 }finally{done(db);}
});

test('quota windows parse ISO dates correctly and include already settled spend',async()=>{
 const db=fixture();try{db.sql.exec('UPDATE usage_limits SET daily_credit_limit=16');await billed(db,'first',{inputTokens:10,outputTokens:5});
  await assert.rejects(reserved(db,'second'),fails('DAILY_QUOTA_REACHED'));
 }finally{done(db);}
});

test('started or unknown provider work cannot be released without confirmed non-billing evidence',async()=>{
 const db=fixture();try{
  for(const state of ['started','unknown']){
   const key='reconcile-'+state,row=await reserved(db,key);
   await beginDispatch(db,alice,row);if(state==='unknown')await markUnknown(db,alice,row);
   await assert.rejects(releaseChat(db,alice,row),fails('RECONCILIATION_REQUIRED'));
   let receipt=await getChatReceipt(db,alice,key);assert.equal(receipt.status,'reserved');assert.equal(receipt.reconciliationRequired,true);
   const providerRequestId='provider-'+state;
   receipt=await releaseChat(db,alice,row,{confirmedNotBilled:true,providerRequestId});
   assert.equal(receipt.status,'released');assert.equal(receipt.reconciliationRequired,false);
  }
  invariant(db);
 }finally{done(db);}
});

test('confirmed non-billing release requires bounded provider evidence',async()=>{
 const db=fixture();try{
  const row=await reserved(db,'evidence-required');await beginDispatch(db,alice,row);
  for(const providerRequestId of [null,'','x'.repeat(201)])
   await assert.rejects(releaseChat(db,alice,row,{confirmedNotBilled:true,providerRequestId}),fails('RECONCILIATION_REQUIRED'));
  const receipt=await getChatReceipt(db,alice,'evidence-required');
  assert.equal(receipt.status,'reserved');assert.equal(receipt.reconciliationRequired,true);invariant(db);
 }finally{done(db);}
});

test('unknown provider outcome cannot be settled or released twice',async()=>{
 const db=fixture();try{
  const row=await reserved(db,'unknown-terminal');await beginDispatch(db,alice,row);await markUnknown(db,alice,row,'NETWORK_AFTER_DISPATCH');
  const settled=await settleChat(db,alice,row,{inputTokens:10,outputTokens:5},'provider-unknown-terminal');
  assert.equal(settled.status,'settled');assert.equal(settled.reconciliationRequired,false);
  await assert.rejects(settleChat(db,alice,row,{inputTokens:10,outputTokens:5},'provider-unknown-terminal'),fails('RESERVATION_FINALIZED'));
  await assert.rejects(releaseChat(db,alice,row,{confirmedNotBilled:true,providerRequestId:'provider-unknown-terminal'}),fails('RECONCILIATION_REQUIRED'));
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE reservation_id=? AND event_type='settle'").get(row.id).n,1);
  invariant(db);
 }finally{done(db);}
});

test('confirmed-not-billed reconciliation is terminal and cannot later settle',async()=>{
 const db=fixture();try{
  const row=await reserved(db,'release-terminal');await beginDispatch(db,alice,row);await markUnknown(db,alice,row);
  const released=await releaseChat(db,alice,row,{confirmedNotBilled:true,providerRequestId:'provider-release-terminal'});
  assert.equal(released.status,'released');
  await assert.rejects(settleChat(db,alice,row,{inputTokens:1,outputTokens:1},'provider-release-terminal'),fails('RESERVATION_FINALIZED'));
  await assert.rejects(releaseChat(db,alice,row,{confirmedNotBilled:true,providerRequestId:'provider-release-terminal'}),fails('RECONCILIATION_REQUIRED'));
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE reservation_id=? AND event_type='release'").get(row.id).n,1);
  invariant(db);
 }finally{done(db);}
});
