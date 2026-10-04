import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectChatActivation} from '../backend/chat-activation.mjs';
import {fixture,cfg} from './billing-fixtures.mjs';
const base={ENVIRONMENT:'test',CHAT_EXECUTION_ENABLED:'true',CHAT_PROVIDER:cfg.provider,CHAT_MODEL:cfg.model,CHAT_PROVIDER_URL:'https://metered.example.invalid/responses',CHAT_PROVIDER_ALLOWED_ORIGIN:'https://metered.example.invalid',CHAT_PROVIDER_PROTOCOL:'metered-v1',CHAT_PROVIDER_API_KEY:'test-only-secret',CHAT_MAX_INPUT_TOKENS:'100',CHAT_MAX_OUTPUT_TOKENS:'50',CHAT_GLOBAL_DAILY_COST_MICROUSD:'100000'};
test('activation audit is safe-off and never eligible by default',async()=>{const db=fixture();const out=await inspectChatActivation({...base,...db,CHAT_EXECUTION_ENABLED:'false'});assert.equal(out.eligible,false);assert.equal(out.safeOff,true);assert.ok(out.blockers.some(x=>x.code==='EXECUTION_DISABLED'));db.sql.close();});
test('activation audit requires all provider route settings without revealing secrets',async()=>{const db=fixture();const out=await inspectChatActivation({...base,...db,CHAT_EXECUTION_ENABLED:'true',CHAT_PROVIDER_PROTOCOL:'raw-model'});assert.equal(out.eligible,false);assert.ok(out.blockers.some(x=>x.code==='PROVIDER_NOT_CONFIGURED'));assert.doesNotMatch(JSON.stringify(out),/test-only-secret/);db.sql.close();});
test('activation audit passes only with policy, current price and no unresolved holds',async()=>{const db=fixture();const out=await inspectChatActivation({...base,...db});assert.equal(out.eligible,true);assert.equal(out.safeOff,false);assert.deepEqual(out.checks,{config:true,billingPolicy:true,currentPrice:true,unresolvedReservations:0});db.sql.close();});
test('activation audit blocks missing current price',async()=>{const db=fixture();const noPrice={...base,...db,CHAT_MODEL:'different-model'};const out=await inspectChatActivation(noPrice);assert.equal(out.eligible,false);assert.ok(out.blockers.some(x=>x.code==='CURRENT_PRICE_SNAPSHOT_REQUIRED'));db.sql.close();});
test('activation audit blocks unresolved holds instead of authorizing new paid work',async()=>{const db=fixture();const {reserveChat}=await import('../backend/chat-billing.mjs');const hold=await reserveChat(db,{sub:'alice',verified:true},'hold-key',[{role:'user',content:'Hello'}],cfg);assert.equal(hold.status,'reserved');const out=await inspectChatActivation({...base,...db});assert.equal(out.eligible,false);assert.ok(out.blockers.some(x=>x.code==='UNRESOLVED_RESERVATIONS'));db.sql.close();});

test('production activation requires independent paid-execution confirmation',async()=>{const db=fixture();const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production'});assert.equal(out.eligible,false);assert.ok(out.blockers.some(x=>x.code==='PAID_EXECUTION_CONFIRMATION_REQUIRED'));db.sql.close();});
test('production activation accepts exact independent confirmation only',async()=>{const db=fixture();const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT',CHAT_PROVIDER_GATEWAY_AUDITED:'true',CHAT_PROVIDER_APPROVED_ORIGIN:'https://metered.example.invalid'});assert.equal(out.eligible,true);assert.equal(out.safeOff,false);assert.ok(!out.blockers.some(x=>x.code==='PAID_EXECUTION_CONFIRMATION_REQUIRED'));db.sql.close();});
test('production activation rejects near-match confirmation',async()=>{const db=fixture();const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'uvenaro_enable_paid_chat'});assert.equal(out.eligible,false);assert.ok(out.blockers.some(x=>x.code==='PAID_EXECUTION_CONFIRMATION_REQUIRED'));db.sql.close();});

test('production activation rejects an environment ceiling above the authoritative DB budget',async()=>{const db=fixture();db.sql.exec("UPDATE chat_billing_policy SET global_daily_cost_microusd=99999 WHERE id='chat'");const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT',CHAT_PROVIDER_GATEWAY_AUDITED:'true',CHAT_PROVIDER_APPROVED_ORIGIN:'https://metered.example.invalid',CHAT_GLOBAL_DAILY_COST_MICROUSD:'100000'});assert.equal(out.eligible,false);assert.ok(out.blockers.some(x=>x.code==='ENV_BUDGET_EXCEEDS_DB_BUDGET'));db.sql.close();});

test('production activation requires an audited metered gateway',async()=>{const db=fixture();const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT'});assert.equal(out.eligible,false);assert.ok(out.blockers.some(x=>x.code==='PROVIDER_GATEWAY_AUDIT_REQUIRED'));db.sql.close();});
test('production activation forbids direct raw model vendor routes',async()=>{const db=fixture();const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT',CHAT_PROVIDER_GATEWAY_AUDITED:'true',CHAT_PROVIDER_URL:'https://api.openai.com/v1/responses',CHAT_PROVIDER_ALLOWED_ORIGIN:'https://api.openai.com'});assert.equal(out.eligible,false);assert.ok(out.blockers.some(x=>x.code==='RAW_PROVIDER_ROUTE_FORBIDDEN'));db.sql.close();});
test('production activation cannot redirect spend by changing route and allowed origin away from the pinned gateway',async()=>{const db=fixture();const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT',CHAT_PROVIDER_GATEWAY_AUDITED:'true',CHAT_PROVIDER_APPROVED_ORIGIN:'https://metered.example.invalid',CHAT_PROVIDER_URL:'https://alternate.example.invalid/responses',CHAT_PROVIDER_ALLOWED_ORIGIN:'https://alternate.example.invalid'});assert.equal(out.eligible,false);assert.ok(out.blockers.some(x=>x.code==='UNAPPROVED_GATEWAY_ROUTE'));db.sql.close();});

test('production activation rejects malformed, insecure or non-canonical approved gateway origins',async()=>{
  const invalid=['http://metered.example.invalid','https://metered.example.invalid/path','https://user:pass@metered.example.invalid','https://metered.example.invalid?x=1','https://metered.example.invalid#fragment','https://metered.example.invalid/'];
  for (const approved of invalid) {
    const db=fixture();
    const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT',CHAT_PROVIDER_GATEWAY_AUDITED:'true',CHAT_PROVIDER_APPROVED_ORIGIN:approved});
    assert.equal(out.eligible,false,approved);
    assert.ok(out.blockers.some(x=>x.code==='APPROVED_GATEWAY_ORIGIN_INVALID'),approved);
    db.sql.close();
  }
});

test('production activation audit explicitly reports missing gateway trust-boundary configuration',async()=>{
  const db=fixture();
  const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT'});
  assert.equal(out.eligible,false);
  assert.ok(out.blockers.some(x=>x.code==='CHAT_PROVIDER_GATEWAY_AUDITED_MISSING'));
  assert.ok(out.blockers.some(x=>x.code==='CHAT_PROVIDER_APPROVED_ORIGIN_MISSING'));
  db.sql.close();
});

test('production activation requires the audited gateway assertion to be exact true',async()=>{
  for (const audited of ['false','TRUE','1','yes']) {
    const db=fixture();
    const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT',CHAT_PROVIDER_GATEWAY_AUDITED:audited,CHAT_PROVIDER_APPROVED_ORIGIN:'https://metered.example.invalid'});
    assert.equal(out.eligible,false,audited);
    assert.ok(out.blockers.some(x=>x.code==='PROVIDER_GATEWAY_AUDIT_REQUIRED'),audited);
    db.sql.close();
  }
});

test('production activation rejects provider allowed-origin drift even when the provider URL stays pinned',async()=>{
  const db=fixture();
  const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT',CHAT_PROVIDER_GATEWAY_AUDITED:'true',CHAT_PROVIDER_APPROVED_ORIGIN:'https://metered.example.invalid',CHAT_PROVIDER_ALLOWED_ORIGIN:'https://alternate.example.invalid'});
  assert.equal(out.eligible,false);
  assert.ok(out.blockers.some(x=>x.code==='PROVIDER_ROUTE_NOT_ALLOWED'));
  db.sql.close();
});

test('production activation rejects provider URL path credentials query and fragment before becoming eligible',async()=>{
  const invalid=[
    'https://user:pass@metered.example.invalid/responses',
    'https://metered.example.invalid/responses?debug=1',
    'https://metered.example.invalid/responses#fragment'
  ];
  for (const url of invalid) {
    const db=fixture();
    const out=await inspectChatActivation({...base,...db,ENVIRONMENT:'production',CHAT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_CHAT',CHAT_PROVIDER_GATEWAY_AUDITED:'true',CHAT_PROVIDER_APPROVED_ORIGIN:'https://metered.example.invalid',CHAT_PROVIDER_URL:url});
    assert.equal(out.eligible,false,url);
    assert.ok(out.blockers.some(x=>x.code==='PROVIDER_ROUTE_NOT_ALLOWED'),url);
    db.sql.close();
  }
});
