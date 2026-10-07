import test from 'node:test';
import assert from 'node:assert/strict';
import adapter from '../backend/gemini-adapter.mjs';
import {recoverGatewayReceipt} from '../backend/metered-gateway.mjs';
import {adapterFixture,adapterRead,adapterDispatch,model} from './gemini-adapter-fixtures.mjs';
import {d1} from './billing-fixtures.mjs';
import {markUnknown} from '../backend/chat-billing.mjs';
import {readFileSync} from 'node:fs';
test('committed adapter deployment cannot expose public preview or enable vendor execution',()=>{
 const config=JSON.parse(readFileSync(new URL('../deploy/gemini-adapter/wrangler.json',import.meta.url),'utf8'));
 assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);assert.equal(config.routes,undefined);
 assert.equal(config.vars.GEMINI_GENERATION_ENABLED,'false');assert.equal(config.vars.GEMINI_EXECUTION_CONFIRMATION,'');assert.equal(config.vars.GEMINI_MODEL,'');
 for(const name of ['GEMINI_MODEL_PROFILE_AUDITED','GEMINI_PREFLIGHT_AUDITED','GEMINI_COUNT_TOKENS_NONBILLABLE_AUDITED','GEMINI_PRIVACY_PRICING_AUDITED'])assert.equal(config.vars[name],'false');
 assert.equal(config.vars.GEMINI_API_KEY,undefined);assert.equal(new Set(config.d1_databases.map(db=>db.database_id)).size,3);
});
test('Gemini preflight uses complete request and bills thinking plus answer tokens',()=>adapterFixture(async h=>{
 const response=await adapter.fetch(h.request(),h.env);assert.equal(response.status,200,await response.clone().text());
 const result=await response.json();assert.deepEqual(result.usage,{input_tokens:10,output_tokens:8});assert.equal(result.output,'Bounded Google answer');
 assert.equal(h.calls.length,2);assert.ok(h.calls[0].url.endsWith(':countTokens'));assert.ok(h.calls[1].url.endsWith(':generateContent'));
 const counted=JSON.parse(h.calls[0].options.body).generateContentRequest,generated=JSON.parse(h.calls[1].options.body);
 assert.equal(counted.model,'models/'+model);delete counted.model;assert.deepEqual(counted,generated);
 assert.equal(generated.generationConfig.maxOutputTokens,50);assert.equal(generated.generationConfig.candidateCount,1);
 assert.equal(generated.generationConfig.thinkingConfig.thinkingLevel,'low');assert.equal(generated.tools,undefined);
 const receipt=await (await adapter.fetch(h.readRequest(),h.env)).json();assert.equal(receipt.output,undefined);assert.equal(receipt.billable,true);
 assert.equal(h.adapterSql.prepare('SELECT COUNT(*) AS n FROM adapter_vendor_evidence').get().n,1);
}));
test('preflight over budget produces a no-charge receipt with no generation call',()=>adapterFixture(async h=>{
 globalThis.fetch=async()=>{h.calls.push('count');return Response.json({totalTokens:99});};
 const receipt=await (await adapter.fetch(h.request(),h.env)).json();assert.equal(receipt.status,'rejected');assert.equal(receipt.billable,false);
 assert.equal(h.calls.length,1);assert.equal(h.adapterSql.prepare('SELECT COUNT(*) AS n FROM adapter_vendor_evidence').get().n,0);
}));
test('adapter read credentials cannot generate and generation credentials cannot read',()=>adapterFixture(async h=>{
 assert.equal((await adapter.fetch(h.request(h.body,adapterRead),h.env)).status,401);
 assert.equal((await adapter.fetch(h.readRequest(adapterDispatch),h.env)).status,401);assert.equal(h.calls.length,0);
}));
for(const [name,change] of Object.entries({
 'generation off':{GEMINI_GENERATION_ENABLED:'false'},'missing confirmation':{GEMINI_EXECUTION_CONFIRMATION:''},
 'preflight unaudited':{GEMINI_PREFLIGHT_AUDITED:'false'},'privacy/pricing unaudited':{GEMINI_PRIVACY_PRICING_AUDITED:'false'},
 'count method pricing unaudited':{GEMINI_COUNT_TOKENS_NONBILLABLE_AUDITED:'false'},'missing API key':{GEMINI_API_KEY:''},
 'unconfigured model':{GEMINI_MODEL:''},'unsafe margin':{GEMINI_PREFLIGHT_TOKEN_MARGIN:'0'}
}))test(name+' blocks all Google requests',()=>adapterFixture(async h=>{
 assert.equal((await adapter.fetch(h.request(),{...h.env,...change})).status,503);assert.equal(h.calls.length,0);
}));
for(const [name,change] of Object.entries({
 'forged provider':{provider:'foreign'},'changed prompt':{messages:[{role:'user',content:'Changed'}]},'wrong token limit':{max_input_tokens:101},'tools':{tools:[{}]}
}))test(name+' cannot bypass application reservation binding',()=>adapterFixture(async h=>{
 assert.notEqual((await adapter.fetch(h.request({...h.body,...change}),h.env)).status,200);assert.equal(h.calls.length,0);
}));
test('missing gateway durable claim blocks direct service-key generation',()=>adapterFixture(async h=>{
 h.env.GATEWAY_DB={prepare(){return {bind(){return this;},async first(){return null;}};}};
 assert.equal((await adapter.fetch(h.request(),h.env)).status,409);assert.equal(h.calls.length,0);
}));
test('concurrent and restarted adapter calls never repeat generation',()=>adapterFixture(async h=>{
 const results=await Promise.all(Array.from({length:8},()=>adapter.fetch(h.request(),h.env)));assert.equal(results.filter(x=>x.status===200).length,1);
 assert.equal(h.calls.filter(x=>x.url.endsWith(':generateContent')).length,1);
 assert.equal((await adapter.fetch(h.request(),{...h.env})).status,409);
}));
test('kill switch changed during preflight prevents subsequent generation',()=>adapterFixture(async h=>{
 globalThis.fetch=async()=>{h.calls.push('count');h.gatewaySql.exec('UPDATE gateway_control SET enabled=0');return Response.json({totalTokens:10});};
 assert.equal((await (await adapter.fetch(h.request(),h.env)).json()).status,'rejected');assert.equal(h.calls.length,1);
}));
test('reservation becoming uncertain during preflight prevents generation',()=>adapterFixture(async h=>{
 globalThis.fetch=async()=>{h.calls.push('count');await markUnknown(h.db,{sub:'alice'},h.row);return Response.json({totalTokens:10});};
 assert.equal((await (await adapter.fetch(h.request(),h.env)).json()).status,'rejected');assert.equal(h.calls.length,1);
}));
test('lost adapter claim acknowledgement never contacts Google',()=>adapterFixture(async h=>{
 h.env.ADAPTER_DB=d1(h.adapterSql,{afterRun(query){if(query.includes('INSERT INTO gateway_receipts'))throw Error('lost claim acknowledgement');}});
 assert.equal((await adapter.fetch(h.request(),h.env)).status,503);assert.equal(h.calls.length,0);
 assert.equal((await adapter.fetch(h.request(),h.env)).status,409);assert.equal(h.calls.length,0);
}));
for(const phase of ['countTokens','generateContent'])for(const kind of ['headers','body'])test(phase+' deadline stops stalled '+kind+' without retry',()=>adapterFixture(async h=>{
 let cancelled=false;globalThis.fetch=async url=>{
  h.calls.push(String(url));if(!String(url).endsWith(':'+phase))return Response.json({totalTokens:10});
  if(kind==='headers')return new Promise(()=>{});
  return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});
 };
 const result=await adapter.fetch(h.request(),{...h.env,GEMINI_TIMEOUT_MS:'100'});assert.equal(result.status,phase==='countTokens'?200:503);
 const receipt=await (await adapter.fetch(h.readRequest(),h.env)).json();assert.equal(receipt.status,phase==='countTokens'?'rejected':'unknown');
 assert.equal(h.calls.length,phase==='countTokens'?1:2);if(kind==='body')assert.equal(cancelled,true);
 assert.equal((await adapter.fetch(h.request(),h.env)).status,409);
}));
test('known billable usage without output is retained for receipt reconciliation',()=>adapterFixture(async h=>{
 globalThis.fetch=async url=>{h.calls.push(String(url));return Response.json(String(url).endsWith(':countTokens')?{totalTokens:10}:{...h.vendor,candidates:[]});};
 assert.equal((await adapter.fetch(h.request(),h.env)).status,503);
 const receipt=await (await adapter.fetch(h.readRequest(),h.env)).json();assert.equal(receipt.status,'completed');assert.equal(receipt.billable,true);
 assert.equal(receipt.usage.output_tokens,8);assert.equal(h.calls.length,2);
}));
test('oversized vendor body cannot stall termination by ignoring cancellation',{timeout:2000},()=>adapterFixture(async h=>{
 globalThis.fetch=async url=>String(url).endsWith(':countTokens')?Response.json({totalTokens:10}):new Response(new ReadableStream({
  start(controller){controller.enqueue(new Uint8Array(262145));},cancel(){return new Promise(()=>{});}
 }),{headers:{'content-type':'application/json'}});
 assert.equal((await adapter.fetch(h.request(),h.env)).status,503);
 assert.equal(h.adapterSql.prepare('SELECT status FROM gateway_receipts').get().status,'unknown');
 assert.equal(h.adapterSql.prepare('SELECT enabled FROM gateway_control').get().enabled,0);
}));
for(const [name,change] of Object.entries({
 'thoughts exceed output ceiling':{usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,thoughtsTokenCount:46,totalTokenCount:61}},
 'accounting does not add up':{usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,thoughtsTokenCount:3,totalTokenCount:17}},
 'preflight drift':{usageMetadata:{promptTokenCount:30,candidatesTokenCount:5,thoughtsTokenCount:0,totalTokenCount:35}},
 'tool billing':{usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,thoughtsTokenCount:3,totalTokenCount:18,toolUsePromptTokenCount:1}},
 'missing response id':{responseId:''}
}))test(name+' holds uncertainty and disables adapter spend',()=>adapterFixture(async h=>{
 globalThis.fetch=async url=>Response.json(String(url).endsWith(':countTokens')?{totalTokens:10}:{...h.vendor,...change});
 assert.equal((await adapter.fetch(h.request(),h.env)).status,503);
 assert.equal(h.adapterSql.prepare('SELECT status FROM gateway_receipts').get().status,'unknown');assert.equal(h.adapterSql.prepare('SELECT enabled FROM gateway_control').get().enabled,0);
}));
test('lost evidence acknowledgement is recovered by read-only receipt projection',()=>adapterFixture(async h=>{
 h.env.ADAPTER_DB=d1(h.adapterSql,{afterRun(query){if(query.includes('INSERT INTO adapter_vendor_evidence'))throw Error('lost evidence acknowledgement');}});
 assert.equal((await adapter.fetch(h.request(),h.env)).status,503);assert.equal(h.adapterSql.prepare('SELECT status FROM gateway_receipts').get().status,'unknown');
 const receipt=await (await adapter.fetch(h.readRequest(),{...h.env,GEMINI_GENERATION_ENABLED:'false',GEMINI_API_KEY:''})).json();
 assert.equal(receipt.status,'completed');assert.equal(receipt.usage.output_tokens,8);
 assert.equal(h.adapterSql.prepare('SELECT status FROM gateway_receipts').get().status,'unknown');assert.equal(h.calls.length,2);
}));
test('lost raw Google response stays unknown and lookup never creates a vendor call',()=>adapterFixture(async h=>{
 let calls=0;globalThis.fetch=async url=>{calls++;if(String(url).endsWith(':countTokens'))return Response.json({totalTokens:10});throw Error('fixture-google-key');};
 const response=await adapter.fetch(h.request(),h.env);assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/fixture-google-key/);
 const receipt=await (await adapter.fetch(h.readRequest(),h.env)).json();assert.equal(receipt.status,'unknown');assert.equal(receipt.billable,null);assert.equal(calls,2);
 assert.equal((await adapter.fetch(h.request(),h.env)).status,409);assert.equal(calls,2);
}));
test('gateway can recover adapter evidence without any new generation',()=>adapterFixture(async h=>{
 assert.equal((await adapter.fetch(h.request(),h.env)).status,200);
 const env={...h.db,GATEWAY_DB:h.env.GATEWAY_DB,ENVIRONMENT:'production',GATEWAY_PROVIDER:'google-gemini',GATEWAY_MODEL:model,
  GATEWAY_DISPATCH_KEY:'d'.repeat(43),GATEWAY_RECEIPT_KEY:'r'.repeat(43),GATEWAY_GENERATION_ENABLED:'false',GATEWAY_ADAPTER_PROTOCOL:'bounded-metered-v1',
  GATEWAY_ADAPTER_DISPATCH_KEY:adapterDispatch,GATEWAY_ADAPTER_RECEIPT_KEY:adapterRead,GATEWAY_PROVIDER_ADAPTER_AUDITED:'true',GATEWAY_RECOVERY_ENABLED:'true',
  GATEWAY_RECOVERY_CONFIRMATION:'UVENARO_RECOVER_GATEWAY_RECEIPTS',PROVIDER_ADAPTER:{fetch:request=>adapter.fetch(request,h.env)}};
 const receipt=await recoverGatewayReceipt(env,h.row.id);assert.equal(receipt.status,'completed');assert.equal(receipt.usage.output_tokens,8);assert.equal(h.calls.length,2);
}));
test('evidence is immutable and contains no conversation or generated answer',()=>adapterFixture(async h=>{
 await adapter.fetch(h.request(),h.env);
 const serialized=JSON.stringify(h.adapterSql.prepare('SELECT * FROM adapter_vendor_evidence').all());assert.doesNotMatch(serialized,/Bounded Google answer|Hello/);
 assert.throws(()=>h.adapterSql.exec('UPDATE adapter_vendor_evidence SET input_tokens=0'),/IMMUTABLE/);
 assert.throws(()=>h.adapterSql.exec('DELETE FROM adapter_vendor_evidence'),/RETENTION/);
}));
