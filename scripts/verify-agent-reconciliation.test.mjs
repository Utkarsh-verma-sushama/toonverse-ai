import test from 'node:test';
import assert from 'node:assert/strict';
import {listAgentReconciliation,reconcileAgent} from '../backend/agent-reconciliation.mjs';
import {fixture,alice,cfg,messages,balance,seedUser,invariant} from './billing-fixtures.mjs';
import {reserveChat,beginDispatch,markUnknown,expireUndispatched} from '../backend/chat-billing.mjs';
import {DatabaseSync} from 'node:sqlite';
const fails=code=>error=>error.code===code;
async function unresolved(db,key='agent_run1'){
 const row=await reserveChat(db,alice,key,messages,cfg);await beginDispatch(db,alice,row);await markUnknown(db,alice,row,'AGENT_PROVIDER_OUTCOME_UNKNOWN');return row;
}
test('agent reconciliation lists only agent-namespaced unresolved holds',async()=>{
 const db=fixture();try{const agent=await unresolved(db);await unresolved(db,'chat-ordinary');
  const rows=await listAgentReconciliation(db);assert.equal(rows.length,1);assert.equal(rows[0].id,agent.id);assert.match(rows[0].idempotencyKey,/^agent_/);
 }finally{db.sql.close();}
});
test('agent charged evidence settles measured usage exactly once',async()=>{
 const db=fixture();try{const row=await unresolved(db);const receipt=await reconcileAgent(db,row.id,{outcome:'charged',providerRequestId:'agent-gateway-1',inputTokens:10,outputTokens:5});
  assert.equal(receipt.status,'settled');assert.equal(receipt.credits,2);assert.equal(balance(db).reserved,0);
  await assert.rejects(reconcileAgent(db,row.id,{outcome:'charged',providerRequestId:'agent-gateway-1',inputTokens:10,outputTokens:5}),fails('RESERVATION_NOT_FOUND'));
 }finally{db.sql.close();}
});
test('agent no-charge release requires authoritative provider request id',async()=>{
 const db=fixture();try{const row=await unresolved(db);await assert.rejects(reconcileAgent(db,row.id,{outcome:'not_billed'}),fails('RECONCILIATION_REQUIRED'));
  const receipt=await reconcileAgent(db,row.id,{outcome:'not_billed',providerRequestId:'agent-no-charge'});assert.equal(receipt.status,'released');assert.equal(balance(db).reserved,0);
 }finally{db.sql.close();}
});
test('agent reconciliation cannot mutate ordinary chat reservations',async()=>{
 const db=fixture();try{const row=await unresolved(db,'chat-ordinary');await assert.rejects(reconcileAgent(db,row.id,{outcome:'not_billed',providerRequestId:'record'}),fails('RESERVATION_NOT_FOUND'));assert.ok(balance(db).reserved>0);
 }finally{db.sql.close();}
});
test('production agent reconciliation requires independent exact confirmation for read and mutation',async()=>{
 const base=fixture(),env={...base,ENVIRONMENT:'production'};try{const row=await unresolved(env);
  await assert.rejects(listAgentReconciliation(env),fails('RECONCILIATION_NOT_AUTHORIZED'));
  await assert.rejects(reconcileAgent(env,row.id,{outcome:'not_billed',providerRequestId:'record'}),fails('RECONCILIATION_NOT_AUTHORIZED'));
  env.AGENT_RECONCILIATION_CONFIRMATION='UVENARO_RECONCILE_PAID_AGENT';
  assert.equal((await listAgentReconciliation(env)).length,1);
  assert.equal((await reconcileAgent(env,row.id,{outcome:'not_billed',providerRequestId:'record'})).status,'released');
 }finally{base.sql.close();}
});

test('ambiguous or malformed agent evidence preserves the unresolved hold',async()=>{
 const db=fixture();try{const row=await unresolved(db);
  const before=balance(db).reserved;
  for(const evidence of [
   {},{outcome:'unknown',providerRequestId:'record'},
   {outcome:'charged',providerRequestId:'record',inputTokens:-1,outputTokens:1},
   {outcome:'charged',providerRequestId:'record',inputTokens:1,outputTokens:1.5}
  ])await assert.rejects(reconcileAgent(db,row.id,evidence));
  const held=db.sql.prepare("SELECT status,provider_state FROM usage_reservations WHERE id=?").get(row.id);
  assert.equal(held.status,'reserved');assert.equal(held.provider_state,'unknown');assert.equal(balance(db).reserved,before);
 }finally{db.sql.close();}
});

test('stale cleanup targets only expired never-dispatched holds; dispatched uncertainty remains reconciliation-only',async()=>{
 const db=fixture();try{
  // Runtime lifecycle proof: dispatched Agent work becomes started/unknown and is
  // visible only to privileged reconciliation, never to the stale-release path.
  const started=await reserveChat(db,alice,'agent_stale_started',messages,cfg);await beginDispatch(db,alice,started);
  const unknown=await reserveChat(db,alice,'agent_stale_unknown',messages,cfg);await beginDispatch(db,alice,unknown);await markUnknown(db,alice,unknown,'AGENT_PROVIDER_OUTCOME_UNKNOWN');
  const rows=Object.fromEntries(db.sql.prepare("SELECT id,status,provider_state FROM usage_reservations WHERE id IN (?,?)").all(started.id,unknown.id).map(r=>[r.id,r]));
  assert.equal(rows[started.id].status,'reserved');assert.equal(rows[started.id].provider_state,'started');
  assert.equal(rows[unknown.id].status,'reserved');assert.equal(rows[unknown.id].provider_state,'unknown');
  assert.equal((await listAgentReconciliation(db)).length,2);

  // Query-shape proof: cleanup is deliberately restricted to reserved,
  // provider_state=not_started and expired rows. This avoids impossible fixture
  // mutations because expires_at is immutable under the production DB trigger.
  const source=(await import('node:fs')).readFileSync(new URL('../backend/chat-billing.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('export async function expireUndispatched'),source.indexOf('export async function',source.indexOf('export async function expireUndispatched')+30)>0?source.indexOf('export async function',source.indexOf('export async function expireUndispatched')+30):source.length);
  assert.match(fn,/status='reserved'/);
  assert.match(fn,/provider_state='not_started'/);
  assert.match(fn,/julianday\(expires_at\)<=julianday\('now'\)/);
  assert.doesNotMatch(fn,/provider_state\s*=\s*'started'/);
  assert.doesNotMatch(fn,/provider_state\s*=\s*'unknown'/);
 }finally{db.sql.close();}
});

test('stale cleanup executes expiry exactly once without releasing fresh or dispatched holds',async()=>{
 const db=fixture(),clockSql=new DatabaseSync(':memory:');
 try{
  const bob={sub:'bob',verified:true};seedUser(db.sql,bob.sub);
  // Advance SQLite time, not immutable reservation fields. Delegate date parsing
  // and modifiers to real SQLite; all production triggers stay installed.
  let now=Date.now();
  for(const fn of ['julianday','strftime'])db.sql.function(fn,{varargs:true},(...args)=>{
   const values=args.map(value=>value==='now'?new Date(now).toISOString():value);
   return clockSql.prepare(`SELECT ${fn}(${values.map(()=>'?').join(',')}) AS value`).get(...values).value;
  });
  const stale=await reserveChat(db,bob,'agent_stale_expired',messages,cfg);
  const started=await reserveChat(db,alice,'agent_expired_started',messages,cfg);await beginDispatch(db,alice,started);
  const unknown=await unresolved(db,'agent_expired_unknown');
  now+=4*60*1000;
  const fresh=await reserveChat(db,bob,'agent_stale_fresh',messages,cfg);
  const before=balance(db,bob.sub);invariant(db);
  now+=2*60*1000;
  assert.equal((await expireUndispatched(db)).meta.changes,1);
  const row=id=>db.sql.prepare('SELECT * FROM usage_reservations WHERE id=?').get(id);
  assert.equal(row(stale.id).status,'released');assert.equal(row(stale.id).failure_code,'NOT_DISPATCHED');
  assert.equal(row(stale.id).actual_credits,0);assert.equal(row(stale.id).actual_cost_microusd,0);
  assert.equal(row(fresh.id).status,'reserved');assert.equal(row(fresh.id).provider_state,'not_started');
  assert.equal(row(started.id).provider_state,'started');assert.equal(row(started.id).status,'reserved');
  assert.equal(row(unknown.id).provider_state,'unknown');assert.equal(row(unknown.id).status,'reserved');
  assert.equal(balance(db,bob.sub).reserved,before.reserved-stale.estimated_credits);
  assert.equal(balance(db,bob.sub).included,before.included);assert.equal(balance(db,bob.sub).prepaid,before.prepaid);
  assert.equal((await listAgentReconciliation(db)).length,2);invariant(db);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS count FROM usage_ledger WHERE reservation_id=? AND event_type='release'").get(stale.id).count,1);
  const ledger=db.sql.prepare('SELECT COUNT(*) AS count FROM usage_ledger').get().count;
  assert.equal((await expireUndispatched(db)).meta.changes,0);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM usage_ledger').get().count,ledger);invariant(db);
 }finally{db.sql.close();clockSql.close();}
});
