import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileChatFromGateway} from '../backend/chat-gateway-reconciliation.mjs';
import {evaluateProviderAcceptance} from '../backend/provider-acceptance.mjs';
import {getProviderContract} from '../backend/provider-contract.mjs';
import {fixture,alice,cfg,messages,balance} from './billing-fixtures.mjs';
import {reserveChat,beginDispatch,markUnknown} from '../backend/chat-billing.mjs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/provider-acceptance/evidence.json',import.meta.url),'utf8'));

test('safe-off acceptance blocks dispatch while read-only authoritative receipt reconciles once',async()=>{
 const db=fixture();
 try{
  const row=await reserveChat(db,alice,'provider-acceptance-reconcile',messages,cfg);
  await beginDispatch(db,alice,row);await markUnknown(db,alice,row);
  const acceptance=evaluateProviderAcceptance({
   contract:getProviderContract(bundle.provider),
   evidence:bundle.evidence,
   runtime:bundle.runtime
  });
  assert.equal(acceptance.generationAllowed,false);
  assert.equal(bundle.runtime.providerRequestsPermitted,false);
  const env={...db,ENVIRONMENT:'production',CHAT_EXECUTION_ENABLED:'false',
   CHAT_PAID_EXECUTION_CONFIRMATION:'',CHAT_RECONCILIATION_CONFIRMATION:'UVENARO_RECONCILE_PAID_CHAT',
   CHAT_RECEIPT_LOOKUP_ENABLED:'true',CHAT_PROVIDER:cfg.provider,CHAT_MODEL:cfg.model,
   CHAT_PROVIDER_PROTOCOL:'metered-v1',CHAT_RECEIPT_BASE_URL:'https://metered.example.invalid/v1/receipts',
   CHAT_RECEIPT_API_KEY:'receipt-only-secret',CHAT_PROVIDER_ALLOWED_ORIGIN:'https://metered.example.invalid',
   CHAT_PROVIDER_APPROVED_ORIGIN:'https://metered.example.invalid',CHAT_PROVIDER_GATEWAY_AUDITED:'true'};
  const authoritative={protocol:'metered-v1',request_id:row.id,provider:cfg.provider,model:cfg.model,
   id:'provider-record-acceptance-1',status:'completed',billable:true,usage:{input_tokens:10,output_tokens:5}};
  let calls=0;
  const receipt=await reconcileChatFromGateway(env,row.id,{fetcher:async(url,options)=>{
   calls++;assert.equal(options.method,'GET');assert.equal(options.body,undefined);
   assert.equal(url,env.CHAT_RECEIPT_BASE_URL+'/'+row.id);return Response.json(authoritative);
  }});
  assert.equal(receipt.status,'settled');assert.equal(calls,1);assert.equal(balance(db).reserved,0);
 }finally{db.sql.close();}
});
