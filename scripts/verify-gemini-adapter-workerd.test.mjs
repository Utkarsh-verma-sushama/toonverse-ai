import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import {schema,migration,alice,messages} from './billing-fixtures.mjs';
import {gatewaySchema,dispatchKey,receiptKey} from './gateway-fixtures.mjs';
import {adapterSchema,adapterDispatch,adapterRead,model} from './gemini-adapter-fixtures.mjs';
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
test('actual gateway and Gemini Workers preserve bounded evidence and unknown vendor outcomes through restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'uvenaro-adapter-'));let mf,countCalls=0,generationCalls=0;
 const cfg={provider:'google-gemini',model,maxInputTokens:100,maxOutputTokens:50,globalCeiling:100000};
 const common={modules:true,compatibilityDate:'2026-08-06'};
 const workers=[{
  ...common,name:'gateway',scriptPath:fileURLToPath(new URL('../backend/metered-gateway.mjs',import.meta.url)),
  d1Databases:{DB:'adapter-billing',GATEWAY_DB:'adapter-gateway'},serviceBindings:{PROVIDER_ADAPTER:'adapter'},
  bindings:{ENVIRONMENT:'production',GATEWAY_PROVIDER:cfg.provider,GATEWAY_MODEL:model,GATEWAY_GENERATION_ENABLED:'true',
   GATEWAY_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_GATEWAY',GATEWAY_DISPATCH_KEY:dispatchKey,GATEWAY_RECEIPT_KEY:receiptKey,
   GATEWAY_ADAPTER_PROTOCOL:'bounded-metered-v1',GATEWAY_ADAPTER_DISPATCH_KEY:adapterDispatch,GATEWAY_ADAPTER_RECEIPT_KEY:adapterRead,GATEWAY_PROVIDER_ADAPTER_AUDITED:'true'}
 },{
  ...common,name:'adapter',scriptPath:fileURLToPath(new URL('../backend/gemini-adapter.mjs',import.meta.url)),
  d1Databases:{DB:'adapter-billing',GATEWAY_DB:'adapter-gateway',ADAPTER_DB:'adapter-evidence'},
  bindings:{ENVIRONMENT:'production',GEMINI_MODEL:model,GEMINI_GENERATION_ENABLED:'true',GEMINI_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_GEMINI_GENERATION',
   GEMINI_MODEL_PROFILE_AUDITED:'true',GEMINI_PREFLIGHT_AUDITED:'true',GEMINI_COUNT_TOKENS_NONBILLABLE_AUDITED:'true',GEMINI_PRIVACY_PRICING_AUDITED:'true',
   GEMINI_PREFLIGHT_TOKEN_MARGIN:'16',GEMINI_API_KEY:'fixture-google-key',ADAPTER_DISPATCH_KEY:adapterDispatch,ADAPTER_RECEIPT_KEY:adapterRead},
  outboundService:async request=>{
   assert.equal(new URL(request.url).origin,'https://generativelanguage.googleapis.com');assert.equal(request.headers.get('x-goog-api-key'),'fixture-google-key');
   const body=await request.json();
   if(request.url.endsWith(':countTokens')){countCalls++;assert.equal(body.generateContentRequest.generationConfig.maxOutputTokens,50);return Response.json({totalTokens:10});}
   assert.ok(request.url.endsWith(':generateContent'));generationCalls++;
   if(body.contents.at(-1).parts[0].text==='Lost response')return new Response('fixture transport uncertainty',{status:503});
   return Response.json({responseId:'workerd-vendor-1',modelVersion:model,candidates:[{content:{parts:[{text:'Worker fixture answer'}]}}],
    usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,thoughtsTokenCount:3,totalTokenCount:18}});
  }
 }];
 try{
  mf=new Miniflare({d1Persist:directory,workers});let DB=await mf.getD1Database('DB','gateway');
  let gatewayDB=await mf.getD1Database('GATEWAY_DB','gateway'),adapterDB=await mf.getD1Database('ADAPTER_DB','adapter');
  await DB.batch(statements(schema+'\n'+migration).map(q=>DB.prepare(q)));
  await gatewayDB.batch(statements(gatewaySchema).map(q=>gatewayDB.prepare(q)));
  await adapterDB.batch(statements(gatewaySchema+'\n'+adapterSchema).map(q=>adapterDB.prepare(q)));
  await gatewayDB.prepare('UPDATE gateway_control SET enabled=1').run();await adapterDB.prepare('UPDATE gateway_control SET enabled=1').run();
  const now=new Date().toISOString(),start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
  await DB.batch([
   DB.prepare('INSERT INTO billing_accounts VALUES (?,?,?,?,?,?,?,?,?)').bind('alice','free','active',20,80,0,start,end,now),
   DB.prepare('INSERT INTO usage_limits VALUES (?,?,?,?,?,?,?)').bind('alice',1000,10000,100000,1000,null,now),
   DB.prepare('INSERT INTO chat_billing_policy VALUES (?,?,?,?)').bind('chat',1,100000,now),
   DB.prepare('INSERT INTO provider_price_snapshots VALUES (?,?,?,?,?,?,?,?,?)').bind('price',cfg.provider,model,1000000,1000000,10,start,null,end)
  ]);
  const row=await reserveChat({DB},alice,'gemini-workerd',messages,cfg);await beginDispatch({DB},alice,row);
  const post=(reservation,conversation)=>mf.dispatchFetch('https://gateway.invalid/responses',{method:'POST',headers:{authorization:'Bearer '+dispatchKey,'content-type':'application/json','idempotency-key':reservation.id},
   body:JSON.stringify({protocol:'metered-v1',request_id:reservation.id,model,messages:conversation,max_input_tokens:100,max_output_tokens:50,tools:[],store:false})});
  const results=await Promise.all([post(row,messages),post(row,messages),post(row,messages)]);
  assert.equal(results.filter(x=>x.status===200).length,1);assert.equal(countCalls,1);assert.equal(generationCalls,1);
  const output=await results.find(x=>x.status===200).json();assert.equal(output.output,'Worker fixture answer');assert.equal(output.usage.output_tokens,8);
  await markUnknown({DB},alice,row);
  const lostMessages=[{role:'user',content:'Lost response'}],lost=await reserveChat({DB},alice,'gemini-workerd-lost',lostMessages,cfg);await beginDispatch({DB},alice,lost);
  assert.equal((await post(lost,lostMessages)).status,503);assert.equal(countCalls,2);assert.equal(generationCalls,2);
  await mf.dispose();mf=new Miniflare({d1Persist:directory,workers:workers.map(w=>({...w,bindings:{...w.bindings,GATEWAY_GENERATION_ENABLED:'false',GEMINI_GENERATION_ENABLED:'false',GEMINI_API_KEY:''}}))});
  DB=await mf.getD1Database('DB','gateway');adapterDB=await mf.getD1Database('ADAPTER_DB','adapter');
  const adapter=await mf.getWorker('adapter');
  const receipt=await (await adapter.fetch('https://adapter.internal/receipts/'+row.id,{headers:{authorization:'Bearer '+adapterRead}})).json();
  assert.equal(receipt.status,'completed');assert.equal(receipt.usage.output_tokens,8);assert.equal(receipt.output,undefined);
  const uncertain=await (await adapter.fetch('https://adapter.internal/receipts/'+lost.id,{headers:{authorization:'Bearer '+adapterRead}})).json();
  assert.equal(uncertain.status,'unknown');assert.equal(uncertain.billable,null);assert.equal(countCalls,2);assert.equal(generationCalls,2);
  const env={DB,ENVIRONMENT:'production',CHAT_PROVIDER:cfg.provider,CHAT_MODEL:model,CHAT_PROVIDER_PROTOCOL:'metered-v1',CHAT_RECEIPT_LOOKUP_ENABLED:'true',
   CHAT_RECONCILIATION_CONFIRMATION:'UVENARO_RECONCILE_PAID_CHAT',CHAT_RECEIPT_API_KEY:receiptKey,CHAT_RECEIPT_BASE_URL:'https://gateway.invalid/receipts',
   CHAT_PROVIDER_ALLOWED_ORIGIN:'https://gateway.invalid',CHAT_PROVIDER_APPROVED_ORIGIN:'https://gateway.invalid',CHAT_PROVIDER_GATEWAY_AUDITED:'true'};
  const reconciled=await reconcileChatFromGateway(env,row.id,{fetcher:(url,options)=>mf.dispatchFetch(url,options)});
  assert.equal(reconciled.credits,2);await assert.rejects(reconcileChatFromGateway(env,row.id,{fetcher:(url,options)=>mf.dispatchFetch(url,options)}),error=>error.code==='RESERVATION_NOT_FOUND');
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE reservation_id=? AND event_type='settle'").bind(row.id).first()).n,1);
  await assert.rejects(adapterDB.prepare('UPDATE adapter_vendor_evidence SET output_tokens=0').run(),/IMMUTABLE/);
  assert.equal((await post(row,messages)).status,503);assert.equal(generationCalls,2);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
