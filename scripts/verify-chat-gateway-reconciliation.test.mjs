import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileChatFromGateway} from '../backend/chat-gateway-reconciliation.mjs';
import {fixture,alice,cfg,messages,balance,invariant} from './billing-fixtures.mjs';
import {reserveChat,beginDispatch,markUnknown} from '../backend/chat-billing.mjs';
const fails=code=>error=>error.code===code;
async function scenario(run,key='gateway-receipt'){
 const db=fixture();try{
  const row=await reserveChat(db,alice,key,messages,cfg);await beginDispatch(db,alice,row);await markUnknown(db,alice,row);
  const env={...db,ENVIRONMENT:'production',CHAT_EXECUTION_ENABLED:'false',CHAT_PAID_EXECUTION_CONFIRMATION:'',
   CHAT_RECONCILIATION_CONFIRMATION:'UVENARO_RECONCILE_PAID_CHAT',CHAT_RECEIPT_LOOKUP_ENABLED:'true',
   CHAT_PROVIDER:cfg.provider,CHAT_MODEL:cfg.model,CHAT_PROVIDER_PROTOCOL:'metered-v1',
   CHAT_RECEIPT_BASE_URL:'https://metered.example.invalid/v1/receipts',CHAT_RECEIPT_API_KEY:'receipt-only-secret',
   CHAT_PROVIDER_ALLOWED_ORIGIN:'https://metered.example.invalid',CHAT_PROVIDER_APPROVED_ORIGIN:'https://metered.example.invalid',CHAT_PROVIDER_GATEWAY_AUDITED:'true'};
  const evidence={protocol:'metered-v1',request_id:row.id,provider:cfg.provider,model:cfg.model,id:'gateway-record-1',
   status:'completed',billable:true,usage:{input_tokens:10,output_tokens:5}};
  await run({db,row,env,evidence});invariant(db);
 }finally{db.sql.close();}
}
test('operator receipt lookup settles measured usage with generation and paid activation off',()=>scenario(async({db,row,env,evidence})=>{
 let calls=0;
 const receipt=await reconcileChatFromGateway(env,row.id,{fetcher:async(url,options)=>{
  calls++;assert.equal(url,env.CHAT_RECEIPT_BASE_URL+'/'+row.id);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
  assert.equal(options.headers.authorization,'Bearer receipt-only-secret');assert.equal(options.body,undefined);return Response.json(evidence);
 }});
 assert.equal(receipt.status,'settled');assert.equal(receipt.credits,2);assert.equal(balance(db).reserved,0);assert.equal(calls,1);
 await assert.rejects(reconcileChatFromGateway(env,row.id,{fetcher:()=>{calls++;}}),fails('RESERVATION_NOT_FOUND'));assert.equal(calls,1);
}));
test('confirmed zero-charge receipt releases without deducting credits',()=>scenario(async({db,row,env,evidence})=>{
 const receipt=await reconcileChatFromGateway(env,row.id,{fetcher:async()=>Response.json({...evidence,status:'rejected',billable:false,usage:{input_tokens:0,output_tokens:0}})});
 assert.equal(receipt.status,'released');assert.equal(balance(db).reserved,0);assert.equal(balance(db).included,20);
}));
for(const [name,change] of Object.entries({
 'foreign request':{request_id:'foreign'},'wrong model':{model:'another'},'wrong provider':{provider:'another'},
 'wrong protocol':{protocol:'raw-vendor'},'missing provider id':{id:''},'pending receipt':{status:'pending'},
 'ambiguous billing':{billable:undefined},'fractional usage':{usage:{input_tokens:1,output_tokens:1.5}},
 'excess usage':{usage:{input_tokens:101,output_tokens:0}},'negative usage':{usage:{input_tokens:-1,output_tokens:0}},
 'nonzero rejected usage':{status:'rejected',billable:false}
}))test(name+' preserves the unresolved hold',()=>scenario(async({db,row,env,evidence})=>{
 await assert.rejects(reconcileChatFromGateway(env,row.id,{fetcher:async()=>Response.json({...evidence,...change})}),fails('RECONCILIATION_REQUIRED'));
 assert.equal(balance(db).reserved,15);assert.equal(balance(db).included,20);
}));
for(const [name,changes] of Object.entries({
 'missing operator confirmation':{CHAT_RECONCILIATION_CONFIRMATION:''},'receipt lookup off':{CHAT_RECEIPT_LOOKUP_ENABLED:'false'},
 'missing secret':{CHAT_RECEIPT_API_KEY:''},'unapproved origin':{CHAT_PROVIDER_APPROVED_ORIGIN:'https://another.invalid'},
 'gateway unaudited':{CHAT_PROVIDER_GATEWAY_AUDITED:'false'},'URL credentials':{CHAT_RECEIPT_BASE_URL:'https://user:pass@metered.example.invalid/v1/receipts'},
 'URL query':{CHAT_RECEIPT_BASE_URL:'https://metered.example.invalid/v1/receipts?token=secret'},
 'raw vendor':{CHAT_RECEIPT_BASE_URL:'https://api.openai.com/v1/receipts',CHAT_PROVIDER_ALLOWED_ORIGIN:'https://api.openai.com',CHAT_PROVIDER_APPROVED_ORIGIN:'https://api.openai.com'},
 'changed provider snapshot':{CHAT_MODEL:'new-model'},'invalid deadline':{CHAT_RECEIPT_TIMEOUT_MS:'Infinity'}
}))test(name+' blocks before network access',()=>scenario(async({db,row,env})=>{
 let calls=0;await assert.rejects(reconcileChatFromGateway({...env,...changes},row.id,{fetcher:()=>{calls++;throw Error('secret detail');}}));
 assert.equal(calls,0);assert.equal(balance(db).reserved,15);
}));
test('agent reservations cannot bypass separate agent reconciliation authorization',()=>scenario(async({db,row,env})=>{
 let calls=0;await assert.rejects(reconcileChatFromGateway(env,row.id,{fetcher:()=>{calls++;}}),fails('RESERVATION_NOT_FOUND'));
 assert.equal(calls,0);assert.equal(balance(db).reserved,15);
},'agent_gateway-receipt'));
for(const [name,response] of [
 ['redirect',()=>new Response('private',{status:307,headers:{location:'https://attacker.invalid/secret'}})],
 ['missing receipt',()=>Response.json({status:'not_found'},{status:404})],
 ['invalid JSON',()=>new Response('private-secret',{headers:{'content-type':'application/json'}})],
 ['oversized JSON',()=>new Response('x'.repeat(16385),{headers:{'content-type':'application/json'}})],
 ['HTML response',()=>new Response('<html>secret</html>',{headers:{'content-type':'text/html'}})]
])test(name+' fails closed without leaking upstream details',()=>scenario(async({db,row,env})=>{
 await assert.rejects(reconcileChatFromGateway(env,row.id,{fetcher:async()=>response()}),error=>{
  assert.doesNotMatch(error.message,/secret|attacker|private/);return error.code==='RECONCILIATION_REQUIRED';
 });assert.equal(balance(db).reserved,15);
}));
test('stalled receipt body is cancelled on the deadline and keeps its hold',()=>scenario(async({db,row,env})=>{
 let cancelled=false;
 await assert.rejects(reconcileChatFromGateway({...env,CHAT_RECEIPT_TIMEOUT_MS:'100'},row.id,{fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})}),fails('RECONCILIATION_REQUIRED'));
 assert.equal(cancelled,true);assert.equal(balance(db).reserved,15);
}));
test('network failure preserves the hold and hides credential-bearing diagnostics',()=>scenario(async({db,row,env})=>{
 await assert.rejects(reconcileChatFromGateway(env,row.id,{fetcher:async()=>{throw Error('receipt-only-secret https://private.invalid');}}),error=>{
  assert.equal(error.code,'RECONCILIATION_REQUIRED');assert.doesNotMatch(error.message,/secret|private/);return true;
 });assert.equal(balance(db).reserved,15);
}));
test('concurrent receipt settlement writes one charge and one ledger event',()=>scenario(async({db,row,env,evidence})=>{
 const results=await Promise.allSettled([1,2].map(()=>reconcileChatFromGateway(env,row.id,{fetcher:async()=>Response.json(evidence)})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(balance(db).included,18);assert.equal(balance(db).reserved,0);
 assert.equal(db.sql.prepare("SELECT COUNT(*) AS count FROM usage_ledger WHERE reservation_id=? AND event_type='settle'").get(row.id).count,1);
}));
