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
