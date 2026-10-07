import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import {schema,migration,alice,cfg,messages} from './billing-fixtures.mjs';
import {gatewaySchema,dispatchKey,receiptKey} from './gateway-fixtures.mjs';
import {reserveChat,beginDispatch,markUnknown} from '../backend/chat-billing.mjs';
import {reconcileChatFromGateway} from '../backend/chat-gateway-reconciliation.mjs';
function statements(source){
 const parser=new DatabaseSync(':memory:'),result=[];let pending='';
 try{
  for(const line of source.split('\n')){
   if(!line.trim()||line.trim().startsWith('--'))continue;pending+=line+'\n';if(!line.trim().endsWith(';'))continue;
   try{parser.exec(pending);}catch(error){if(error.message.includes('incomplete input'))continue;throw error;}
   if(!pending.trim().startsWith('PRAGMA'))result.push(pending);pending='';
  }
  assert.equal(pending,'');return result;
 }finally{parser.close();}
}
test('real gateway Worker/D1 survives restart and reconciles lost replies without another POST',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'uvenaro-gateway-'));let mf,calls=0;
 const options={modules:true,scriptPath:fileURLToPath(new URL('../backend/metered-gateway.mjs',import.meta.url)),compatibilityDate:'2026-08-06',
  d1Persist:directory,d1Databases:{DB:'billing-gateway-workerd',GATEWAY_DB:'receipts-gateway-workerd'},
  bindings:{ENVIRONMENT:'production',GATEWAY_PROVIDER:cfg.provider,GATEWAY_MODEL:cfg.model,GATEWAY_GENERATION_ENABLED:'true',
   GATEWAY_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_GATEWAY',GATEWAY_DISPATCH_KEY:dispatchKey,GATEWAY_RECEIPT_KEY:receiptKey,
   GATEWAY_ADAPTER_PROTOCOL:'bounded-metered-v1',GATEWAY_ADAPTER_DISPATCH_KEY:'a'.repeat(43),GATEWAY_ADAPTER_RECEIPT_KEY:'b'.repeat(43),GATEWAY_PROVIDER_ADAPTER_AUDITED:'true'},
  serviceBindings:{PROVIDER_ADAPTER:async request=>{
   calls++;assert.equal(request.method,'POST');const input=await request.json();
   return Response.json({protocol:'metered-v1',request_id:input.request_id,provider:cfg.provider,model:cfg.model,id:'vendor-workerd-1',
    status:'completed',billable:true,output:'Actual Worker fixture answer',usage:{input_tokens:10,output_tokens:5}});
  }}};
 try{
  mf=new Miniflare(options);let DB=await mf.getD1Database('DB'),GATEWAY_DB=await mf.getD1Database('GATEWAY_DB');
  await DB.batch(statements(schema+'\n'+migration).map(q=>DB.prepare(q)));await GATEWAY_DB.batch(statements(gatewaySchema).map(q=>GATEWAY_DB.prepare(q)));
  await GATEWAY_DB.prepare("UPDATE gateway_control SET enabled=1 WHERE id='gateway'").run();
  const now=new Date().toISOString(),start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
  await DB.batch([
   DB.prepare('INSERT INTO billing_accounts VALUES (?,?,?,?,?,?,?,?,?)').bind('alice','free','active',20,80,0,start,end,now),
   DB.prepare('INSERT INTO usage_limits VALUES (?,?,?,?,?,?,?)').bind('alice',1000,10000,100000,1000,null,now),
   DB.prepare('INSERT INTO chat_billing_policy VALUES (?,?,?,?)').bind('chat',1,100000,now),
   DB.prepare('INSERT INTO provider_price_snapshots VALUES (?,?,?,?,?,?,?,?,?)').bind('price',cfg.provider,cfg.model,1000000,1000000,10,start,null,end)
  ]);
  const row=await reserveChat({DB},alice,'gateway-real-worker',messages,cfg);await beginDispatch({DB},alice,row);
  const post=()=>mf.dispatchFetch('https://gateway.invalid/responses',{method:'POST',headers:{authorization:'Bearer '+dispatchKey,'content-type':'application/json','idempotency-key':row.id},
   body:JSON.stringify({protocol:'metered-v1',request_id:row.id,model:cfg.model,messages,max_input_tokens:100,max_output_tokens:50,tools:[],store:false})});
  const results=await Promise.all([post(),post(),post()]);assert.equal(results.filter(x=>x.status===200).length,1);assert.equal(calls,1);
  await markUnknown({DB},alice,row);await mf.dispose();mf=new Miniflare({...options,bindings:{...options.bindings,GATEWAY_GENERATION_ENABLED:'false'}});
  DB=await mf.getD1Database('DB');GATEWAY_DB=await mf.getD1Database('GATEWAY_DB');
  const receipt=await mf.dispatchFetch('https://gateway.invalid/receipts/'+row.id,{headers:{authorization:'Bearer '+receiptKey}});
  assert.equal(receipt.status,200);assert.equal((await receipt.json()).status,'completed');
  const env={DB,ENVIRONMENT:'production',CHAT_PROVIDER:cfg.provider,CHAT_MODEL:cfg.model,CHAT_PROVIDER_PROTOCOL:'metered-v1',CHAT_RECEIPT_LOOKUP_ENABLED:'true',
   CHAT_RECONCILIATION_CONFIRMATION:'UVENARO_RECONCILE_PAID_CHAT',CHAT_RECEIPT_API_KEY:receiptKey,CHAT_RECEIPT_BASE_URL:'https://gateway.invalid/receipts',
   CHAT_PROVIDER_ALLOWED_ORIGIN:'https://gateway.invalid',CHAT_PROVIDER_APPROVED_ORIGIN:'https://gateway.invalid',CHAT_PROVIDER_GATEWAY_AUDITED:'true'};
  const reconciled=await reconcileChatFromGateway(env,row.id,{fetcher:(url,options)=>mf.dispatchFetch(url,options)});
  assert.equal(reconciled.credits,2);assert.equal((await DB.prepare('SELECT reserved_credits FROM billing_accounts').first()).reserved_credits,0);assert.equal(calls,1);
  assert.equal((await post()).status,503);assert.equal(calls,1);
  assert.equal((await GATEWAY_DB.prepare('SELECT COUNT(*) AS n FROM gateway_receipts').first()).n,1);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
