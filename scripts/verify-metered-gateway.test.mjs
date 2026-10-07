import test from 'node:test';
import assert from 'node:assert/strict';
import gateway,{recoverGatewayReceipt} from '../backend/metered-gateway.mjs';
import {reconcileChatFromGateway} from '../backend/chat-gateway-reconciliation.mjs';
import {gatewayFixture,receiptKey,dispatchKey} from './gateway-fixtures.mjs';
import {balance,d1} from './billing-fixtures.mjs';
import {markUnknown} from '../backend/chat-billing.mjs';
const fail=code=>error=>error.code===code;
test('gateway persists measured receipt before reply; read key cannot generate and no text is retained',()=>gatewayFixture(async h=>{
 const response=await gateway.fetch(h.request(),h.env);assert.equal(response.status,200);const output=await response.json();assert.equal(output.output,'Verified answer');
 const receipt=await (await gateway.fetch(h.readRequest(),h.env)).json();assert.equal(receipt.status,'completed');assert.equal(receipt.output,undefined);
 const columns=h.gatewaySql.prepare('PRAGMA table_info(gateway_receipts)').all().map(x=>x.name);assert.ok(!columns.includes('messages'));assert.ok(!columns.includes('output'));
 assert.equal((await gateway.fetch(h.request(h.body,receiptKey),h.env)).status,401);
 assert.equal((await gateway.fetch(h.readRequest(dispatchKey),h.env)).status,401);assert.equal(h.calls.length,1);
 assert.deepEqual(h.calls[0].body.tools,[]);assert.equal(h.calls[0].body.store,false);
}));
test('concurrent and restarted requests claim once; replay never generates again',()=>gatewayFixture(async h=>{
 const results=await Promise.all(Array.from({length:10},()=>gateway.fetch(h.request(),h.env)));
 assert.equal(results.filter(x=>x.status===200).length,1);assert.equal(h.calls.length,1);
 assert.equal((await gateway.fetch(h.request(),{...h.env})).status,409);assert.equal(h.calls.length,1);
 assert.equal(h.gatewaySql.prepare('SELECT COUNT(*) AS n FROM gateway_receipts').get().n,1);
}));
for(const [name,changes] of Object.entries({
 'generation off':{GATEWAY_GENERATION_ENABLED:'false'},'missing paid confirmation':{GATEWAY_PAID_EXECUTION_CONFIRMATION:''},
 'adapter unaudited':{GATEWAY_PROVIDER_ADAPTER_AUDITED:'false'},'wrong adapter protocol':{GATEWAY_ADAPTER_PROTOCOL:'raw-vendor'},
 'same keys':{GATEWAY_RECEIPT_KEY:dispatchKey},'short key':{GATEWAY_DISPATCH_KEY:'short'},'missing database':{GATEWAY_DB:null}
}))test(name+' blocks before dispatch',()=>gatewayFixture(async h=>{
 assert.equal((await gateway.fetch(h.request(),{...h.env,...changes})).status,503);assert.equal(h.calls.length,0);
}));
for(const [name,changes] of Object.entries({
 'foreign reservation':{request_id:'foreign'},'changed messages':{messages:[{role:'user',content:'Changed'}]},
 'wrong model':{model:'wrong'},'larger token budget':{max_output_tokens:51},'tools enabled':{tools:[{name:'execute'}]},'retention enabled':{store:true}
}))test(name+' cannot forge an authorized request',()=>gatewayFixture(async h=>{
 assert.notEqual((await gateway.fetch(h.request({...h.body,...changes}),h.env)).status,200);assert.equal(h.calls.length,0);
}));
test('database and billing kill switches return durable proven no-charge receipts',()=>gatewayFixture(async h=>{
 h.gatewaySql.exec("UPDATE gateway_control SET enabled=0 WHERE id='gateway'");
 const response=await gateway.fetch(h.request(),h.env);assert.equal(response.status,503);
 const receipt=await (await gateway.fetch(h.readRequest(),h.env)).json();assert.equal(receipt.status,'rejected');assert.equal(receipt.billable,false);
 assert.deepEqual(receipt.usage,{input_tokens:0,output_tokens:0});assert.equal(h.calls.length,0);
 assert.equal((await gateway.fetch(h.readRequest(),{...h.env,GATEWAY_GENERATION_ENABLED:'false'})).status,200);
}));
test('billing policy stop prevents adapter calls',()=>gatewayFixture(async h=>{
 h.db.sql.exec("UPDATE chat_billing_policy SET enabled=0 WHERE id='chat'");
 const response=await gateway.fetch(h.request(),h.env);assert.equal((await response.json()).status,'rejected');assert.equal(h.calls.length,0);
}));
test('lost claim-write acknowledgement never invokes adapter',()=>gatewayFixture(async h=>{
 h.env.GATEWAY_DB=d1(h.gatewaySql,{afterRun(query){if(query.includes('INSERT INTO gateway_receipts'))throw Error('lost acknowledgement');}});
 assert.equal((await gateway.fetch(h.request(),h.env)).status,503);assert.equal(h.calls.length,0);
 assert.equal(h.gatewaySql.prepare('SELECT status FROM gateway_receipts').get().status,'dispatching');
 assert.equal((await gateway.fetch(h.request(),h.env)).status,409);
}));
test('adapter uncertainty survives restart; explicit recovery uses GET with generation off',()=>gatewayFixture(async h=>{
 h.env.PROVIDER_ADAPTER.fetch=async request=>{h.calls.push({method:request.method});throw Error('private provider secret');};
 const result=await gateway.fetch(h.request(),h.env);assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/private|secret/);
 assert.equal(h.gatewaySql.prepare('SELECT status FROM gateway_receipts').get().status,'unknown');
 assert.equal((await gateway.fetch(h.request(),h.env)).status,409);
 h.env.PROVIDER_ADAPTER.fetch=async request=>{h.calls.push({method:request.method});assert.equal(request.body,null);return Response.json(h.completed);};
 const receipt=await recoverGatewayReceipt({...h.env,GATEWAY_GENERATION_ENABLED:'false',GATEWAY_PAID_EXECUTION_CONFIRMATION:''},h.row.id);
 assert.equal(receipt.status,'completed');assert.deepEqual(h.calls.map(x=>x.method),['POST','GET']);
 await recoverGatewayReceipt(h.env,h.row.id);assert.equal(h.calls.length,2);
}));
test('operator recovery requires its own confirmation and pending evidence never releases',()=>gatewayFixture(async h=>{
 h.env.PROVIDER_ADAPTER.fetch=async()=>{throw Error('offline');};await gateway.fetch(h.request(),h.env);
 await assert.rejects(recoverGatewayReceipt({...h.env,GATEWAY_RECOVERY_CONFIRMATION:''},h.row.id),fail('GATEWAY_RECOVERY_NOT_AUTHORIZED'));
 h.env.PROVIDER_ADAPTER.fetch=async()=>Response.json({...h.completed,status:'pending'});
 await assert.rejects(recoverGatewayReceipt(h.env,h.row.id),fail('RECONCILIATION_REQUIRED'));
 assert.equal(h.gatewaySql.prepare('SELECT status FROM gateway_receipts').get().status,'unknown');
}));
for(const [name,change] of Object.entries({
 'wrong request':{request_id:'foreign'},'wrong model':{model:'foreign'},'negative tokens':{usage:{input_tokens:-1,output_tokens:5}},
 'excess tokens':{usage:{input_tokens:101,output_tokens:5}},'ambiguous billing':{billable:null},'missing output':{output:''}
}))test(name+' trips the durable gateway spending stop',()=>gatewayFixture(async h=>{
 h.env.PROVIDER_ADAPTER.fetch=async()=>Response.json({...h.completed,...change});
 assert.equal((await gateway.fetch(h.request(),h.env)).status,503);assert.equal(h.gatewaySql.prepare('SELECT enabled FROM gateway_control').get().enabled,0);
 assert.equal(h.gatewaySql.prepare('SELECT status FROM gateway_receipts').get().status,'unknown');
}));
test('redirect and stalled response keep uncertainty without receipt forgery',()=>gatewayFixture(async h=>{
 h.env.PROVIDER_ADAPTER.fetch=async()=>new Response('private',{status:307,headers:{location:'https://attacker.invalid'}});
 assert.equal((await gateway.fetch(h.request(),h.env)).status,503);assert.equal(h.gatewaySql.prepare('SELECT status FROM gateway_receipts').get().status,'unknown');
 assert.equal(h.gatewaySql.prepare('SELECT enabled FROM gateway_control').get().enabled,0);
 let cancelled=false;h.env.PROVIDER_ADAPTER.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});
 await assert.rejects(recoverGatewayReceipt({...h.env,GATEWAY_TIMEOUT_MS:'100'},h.row.id),fail('RECONCILIATION_REQUIRED'));assert.equal(cancelled,true);
}));
test('lost final-write acknowledgement keeps the completed durable receipt recoverable',()=>gatewayFixture(async h=>{
 h.env.GATEWAY_DB=d1(h.gatewaySql,{afterRun(query){if(query.includes('finalized_at='))throw Error('lost final acknowledgement');}});
 assert.equal((await gateway.fetch(h.request(),h.env)).status,503);
 assert.equal(h.gatewaySql.prepare('SELECT status FROM gateway_receipts').get().status,'completed');
 const receipt=await (await gateway.fetch(h.readRequest(),h.env)).json();assert.equal(receipt.billable,true);
 assert.equal((await gateway.fetch(h.request(),h.env)).status,409);assert.equal(h.calls.length,1);
}));
test('lost generation response reconciles through authenticated gateway GET exactly once',()=>gatewayFixture(async h=>{
 assert.equal((await gateway.fetch(h.request(),h.env)).status,200);await markUnknown(h.db,{sub:'alice'},h.row);
 const env={...h.db,ENVIRONMENT:'production',CHAT_EXECUTION_ENABLED:'false',CHAT_PROVIDER:h.body.model==='test-text'?'test-gateway':'',CHAT_MODEL:h.body.model,
  CHAT_PROVIDER_PROTOCOL:'metered-v1',CHAT_RECEIPT_LOOKUP_ENABLED:'true',CHAT_RECEIPT_API_KEY:receiptKey,
  CHAT_RECONCILIATION_CONFIRMATION:'UVENARO_RECONCILE_PAID_CHAT',CHAT_RECEIPT_BASE_URL:'https://gateway.invalid/receipts',
  CHAT_PROVIDER_ALLOWED_ORIGIN:'https://gateway.invalid',CHAT_PROVIDER_APPROVED_ORIGIN:'https://gateway.invalid',CHAT_PROVIDER_GATEWAY_AUDITED:'true'};
 const receipt=await reconcileChatFromGateway(env,h.row.id,{fetcher:(url,options)=>gateway.fetch(new Request(url,options),h.env)});
 assert.equal(receipt.status,'settled');assert.equal(receipt.credits,2);assert.equal(balance(h.db).reserved,0);assert.equal(h.calls.length,1);
}));
test('adapter deadline covers stalled headers even when a service ignores abort',()=>gatewayFixture(async h=>{
 h.env.PROVIDER_ADAPTER.fetch=()=>new Promise(()=>{});
 const response=await gateway.fetch(h.request(),{...h.env,GATEWAY_TIMEOUT_MS:'100'});assert.equal(response.status,503);
 assert.equal(h.gatewaySql.prepare('SELECT status FROM gateway_receipts').get().status,'unknown');
}));
test('receipt database prevents mutation, terminal rewrites, deletion and incomplete finalization',()=>gatewayFixture(async h=>{
 await gateway.fetch(h.request(),h.env);
 assert.throws(()=>h.gatewaySql.prepare("UPDATE gateway_receipts SET input_tokens=0 WHERE request_id=?").run(h.row.id),/IMMUTABLE/);
 assert.throws(()=>h.gatewaySql.prepare('DELETE FROM gateway_receipts WHERE request_id=?').run(h.row.id),/RETENTION/);
 assert.throws(()=>h.gatewaySql.prepare("INSERT INTO gateway_receipts (request_id,request_hash,provider,model,input_limit,output_limit,status,created_at) VALUES ('test',?,'x','x',1,1,'completed','now')").run('a'.repeat(64)),/INVALID_CLAIM/);
 h.gatewaySql.prepare("INSERT INTO gateway_receipts (request_id,request_hash,provider,model,input_limit,output_limit,status,created_at) VALUES ('incomplete',?,'x','x',1,1,'dispatching','now')").run('a'.repeat(64));
 assert.throws(()=>h.gatewaySql.exec("UPDATE gateway_receipts SET status='completed',finalized_at='now' WHERE request_id='incomplete'"),/CHECK/);
}));
