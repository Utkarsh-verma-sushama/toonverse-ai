import test from 'node:test';
import assert from 'node:assert/strict';
import {listChatReconciliation,reconcileChat} from '../backend/chat-reconciliation.mjs';
import {fixture,alice,cfg,messages,balance} from './billing-fixtures.mjs';
import {reserveChat,beginDispatch,markUnknown} from '../backend/chat-billing.mjs';
const fails=code=>error=>error.code===code;

test('reconciliation list exposes only unresolved internal holds',async()=>{
 const db=fixture();try{const row=await reserveChat(db,alice,'recon-list',messages,cfg);await beginDispatch(db,alice,row);await markUnknown(db,alice,row,'TIMEOUT_AFTER_DISPATCH');
  const rows=await listChatReconciliation(db);assert.equal(rows.length,1);assert.equal(rows[0].id,row.id);assert.equal(rows[0].providerState,'unknown');assert.equal(rows[0].estimatedCredits,15);
 }finally{db.sql.close();}
});
test('authoritative charged evidence settles once and uses measured usage',async()=>{
 const db=fixture();try{const row=await reserveChat(db,alice,'recon-settle',messages,cfg);await beginDispatch(db,alice,row);await markUnknown(db,alice,row);
  const receipt=await reconcileChat(db,row.id,{outcome:'charged',providerRequestId:'gateway-record-1',inputTokens:10,outputTokens:5});assert.equal(receipt.status,'settled');assert.equal(receipt.credits,2);assert.equal(balance(db).reserved,0);
  await assert.rejects(reconcileChat(db,row.id,{outcome:'charged',providerRequestId:'gateway-record-1',inputTokens:10,outputTokens:5}),fails('RESERVATION_NOT_FOUND'));
 }finally{db.sql.close();}
});
test('authoritative no-charge evidence releases the hold and cannot be forged',async()=>{
 const db=fixture();try{const row=await reserveChat(db,alice,'recon-release',messages,cfg);await beginDispatch(db,alice,row);await markUnknown(db,alice,row);
  await assert.rejects(reconcileChat(db,row.id,{outcome:'not_billed'}),fails('RECONCILIATION_REQUIRED'));
  const receipt=await reconcileChat(db,row.id,{outcome:'not_billed',providerRequestId:'gateway-no-charge'});assert.equal(receipt.status,'released');assert.equal(balance(db).reserved,0);
 }finally{db.sql.close();}
});
test('reconciliation rejects client-shaped usage and foreign references',async()=>{
 const db=fixture();try{const row=await reserveChat(db,alice,'recon-invalid',messages,cfg);await beginDispatch(db,alice,row);await markUnknown(db,alice,row);
  await assert.rejects(reconcileChat(db,row.id,{outcome:'charged',providerRequestId:'record',inputTokens:10,outputTokens:'5'}),fails('INVALID_PROVIDER_USAGE'));
  await assert.rejects(reconcileChat(db,'foreign',{outcome:'not_billed',providerRequestId:'record'}),fails('RESERVATION_NOT_FOUND'));
 }finally{db.sql.close();}
});

test('production reconciliation requires independent privileged confirmation',async()=>{
 const base=fixture();
 const env={...base,ENVIRONMENT:'production'};
 try{const row=await reserveChat(env,alice,'recon-prod-auth',messages,cfg);await beginDispatch(env,alice,row);await markUnknown(env,alice,row);
  await assert.rejects(reconcileChat(env,row.id,{outcome:'not_billed',providerRequestId:'authoritative-record'}),fails('RECONCILIATION_NOT_AUTHORIZED'));
  env.CHAT_RECONCILIATION_CONFIRMATION='UVENARO_RECONCILE_PAID_CHAT';
  const receipt=await reconcileChat(env,row.id,{outcome:'not_billed',providerRequestId:'authoritative-record'});assert.equal(receipt.status,'released');assert.equal(balance(env).reserved,0);
 }finally{base.sql.close();}
});
