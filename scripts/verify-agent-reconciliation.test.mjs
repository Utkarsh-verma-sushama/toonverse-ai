import test from 'node:test';
import assert from 'node:assert/strict';
import {listAgentReconciliation,reconcileAgent} from '../backend/agent-reconciliation.mjs';
import {fixture,alice,cfg,messages,balance} from './billing-fixtures.mjs';
import {reserveChat,beginDispatch,markUnknown} from '../backend/chat-billing.mjs';
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

test('stale cleanup releases only never-dispatched agent holds and preserves dispatched uncertainty',async()=>{
 const db=fixture();try{
  const {expireUndispatched}=await import('../backend/chat-billing.mjs');
  const never=await reserveChat(db,alice,'agent_stale_never',messages,cfg);
  const started=await reserveChat(db,alice,'agent_stale_started',messages,cfg);await beginDispatch(db,alice,started);
  const bob={sub:'bob',verified:true};db.sql.prepare("INSERT INTO billing_accounts SELECT 'bob',plan_id,status,included_credits,prepaid_credits,reserved_credits,cycle_started_at,cycle_ends_at,updated_at FROM billing_accounts WHERE owner_id='alice'").run();
  db.sql.prepare("INSERT INTO usage_limits SELECT 'bob',daily_credit_limit,monthly_credit_limit,max_request_cost_microusd,requests_per_minute,blocked_until,updated_at,max_concurrent_requests,hourly_cost_limit_microusd FROM usage_limits WHERE owner_id='alice'").run();
  const unknown=await reserveChat(db,bob,'agent_stale_unknown',messages,cfg);await beginDispatch(db,bob,unknown);await markUnknown(db,bob,unknown,'AGENT_PROVIDER_OUTCOME_UNKNOWN');
  db.sql.exec("UPDATE usage_reservations SET expires_at='2000-01-01T00:00:00.000Z' WHERE id IN ('"+never.id+"','"+started.id+"','"+unknown.id+"')");
  await expireUndispatched(db);
  const rows=Object.fromEntries(db.sql.prepare("SELECT id,status,provider_state FROM usage_reservations WHERE id IN (?,?,?)").all(never.id,started.id,unknown.id).map(r=>[r.id,r]));
  assert.equal(rows[never.id].status,'released');assert.equal(rows[never.id].provider_state,'finished');
  assert.equal(rows[started.id].status,'reserved');assert.equal(rows[started.id].provider_state,'started');
  assert.equal(rows[unknown.id].status,'reserved');assert.equal(rows[unknown.id].provider_state,'unknown');
  assert.equal((await listAgentReconciliation(db)).length,2);
 }finally{db.sql.close();}
});
