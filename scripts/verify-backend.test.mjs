import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../backend/worker.mjs';
import {authorizeAgentTool,authorizeAgentToolForRun} from '../backend/agent-runtime.mjs';
import {env, claims, token, mockIdentity} from './security-fixtures.mjs';
import {accountEnv,accountDatabase,seedManaged} from './account-fixtures.mjs';
import {migration as billingMigration,abuseMigration,seedUser} from './billing-fixtures.mjs';
const originalFetch=globalThis.fetch;
before(()=>{globalThis.fetch=mockIdentity().fetch;});
after(()=>{globalThis.fetch=originalFetch;});
const defaults={...env,...accountEnv,ENVIRONMENT:'production',ALLOWED_ORIGINS:'https://uvenaro.com',AGENT_EXECUTION_ENABLED:'true'};
const alice=await token(),bob=await token(claims({sub:'bob'}));
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));sql.exec(billingMigration);sql.exec(abuseMigration);sql.exec(readFileSync(new URL('../backend/migrations/0005_agent_abuse_hardening.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../backend/migrations/0006_agent_audit_trail.sql',import.meta.url),'utf8'));
 const DB={prepare(query){let values=[];return {bind(...args){values=args;return this;},async first(){return sql.prepare(query).get(...values)||null;},async run(){const out=sql.prepare(query).run(...values);return {meta:{changes:Number(out.changes)}};}};}};
 seedUser(sql);
 sql.prepare('INSERT INTO chat_billing_policy VALUES (?,?,?,?)').run('chat',1,1000000,new Date().toISOString());
 sql.prepare('INSERT INTO provider_price_snapshots (id,provider,model,input_microusd_per_million,output_microusd_per_million,credit_value_microusd,effective_at,retired_at,valid_until) VALUES (?,?,?,?,?,?,?,?,?)')
  .run('agent-price','test-provider','test-model',100,100,1000,new Date(Date.now()-86400000).toISOString(),null,new Date(Date.now()+86400000).toISOString());
 const now=new Date().toISOString(),future=new Date(Date.now()+60000).toISOString();
 sql.prepare('INSERT INTO agent_runs (id,owner_id,status,objective,payload_json,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?)').run('run-alice','alice','awaiting_approval','private objective','{}',now,now,'key-alice');
 sql.prepare('INSERT INTO agent_approvals (id,run_id,owner_id,action_type,summary,expires_at) VALUES (?,?,?,?,?,?)').run('approval-alice','run-alice','alice','share','private',future);
 return {sql,DB};
}
async function call(path,{method='GET',value=alice,body,headers={},bindings={}}={}){
 const db=bindings.sql?bindings:accountDatabase();
 try{if(value===alice||value===bob)value=await seedManaged(db.sql,value,value===bob?'bob':'alice');
 return await worker.fetch(new Request(`https://api.uvenaro.invalid${path}`,{method,headers:{...(value?{authorization:`Bearer ${value}`} : {}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),{...defaults,...db,...bindings});
 }finally{if(!bindings.sql)db.sql.close();}
}
function queueMessage(body){let acked=0,retried=0;return {body,ack(){acked++;},retry(){retried++;},get acked(){return acked;},get retried(){return retried;}};}
test('agent tool boundary denies unknown tools and gates irreversible actions',()=>{
 for(const name of ['read_project','search_project','draft_content','analyze_asset'])assert.deepEqual(authorizeAgentTool(name),{tool:name,requiresApproval:false});
 for(const name of ['write_project','share_project','publish_project','delete_project','external_send']){
  assert.throws(()=>authorizeAgentTool(name),e=>e.code==='AGENT_TOOL_APPROVAL_REQUIRED');
  assert.deepEqual(authorizeAgentTool(name,{approvalGranted:true}),{tool:name,requiresApproval:true});
 }
 for(const name of ['shell','http_request','admin','../escape','',null,'A'.repeat(65)])assert.throws(()=>authorizeAgentTool(name),e=>['AGENT_TOOL_INVALID','AGENT_TOOL_NOT_ALLOWED'].includes(e.code));
});

test('sensitive agent tool approval is bound to owner run action and expiry',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_approvals SET action_type='share_project',decision='approve',decided_at=? WHERE id='approval-alice'").run(new Date().toISOString());
  await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'share_project',approvalId:'approval-alice'}),e=>e.code==='AGENT_STEP_REFERENCE_REQUIRED');
  await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'delete_project',approvalId:'approval-alice'}),e=>e.code==='AGENT_TOOL_APPROVAL_MISMATCH');
  await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'bob',toolName:'share_project',approvalId:'approval-alice'}),e=>e.code==='AGENT_TOOL_APPROVAL_REQUIRED');
  db.sql.prepare("UPDATE agent_approvals SET expires_at='2000-01-01T00:00:00Z' WHERE id='approval-alice'").run();
  await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'share_project',approvalId:'approval-alice'}),e=>e.code==='AGENT_TOOL_APPROVAL_REQUIRED');
 }finally{db.sql.close();}
});

test('sensitive agent tool rejects forged approval decision timestamps',async()=>{
 for(const decidedAt of [null,'nonsense','2999-01-01T00:00:00Z']){
  const db=database();try{
   db.sql.prepare("UPDATE agent_approvals SET action_type='share_project',decision='approve',decided_at=? WHERE id='approval-alice'").run(decidedAt);
   await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'share_project',approvalId:'approval-alice'}),e=>e.code==='AGENT_TOOL_APPROVAL_REQUIRED');
  }finally{db.sql.close();}
 }
});

test('sensitive agent tool rejects approval decided at or after expiry',async()=>{
 for(const [decidedAt,expiresAt] of [['2099-01-01T00:00:00Z','2099-01-01T00:00:00Z'],['2099-01-02T00:00:00Z','2099-01-01T00:00:00Z']]){
  const db=database();try{
   db.sql.prepare("UPDATE agent_approvals SET action_type='share_project',decision='approve',decided_at=?,expires_at=? WHERE id='approval-alice'").run(decidedAt,expiresAt);
   await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'share_project',approvalId:'approval-alice'}),e=>e.code==='AGENT_TOOL_APPROVAL_REQUIRED');
  }finally{db.sql.close();}
 }
});

test('sensitive approval cannot bypass exact-step binding',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_approvals SET action_type='share_project',decision='approve',decided_at=? WHERE id='approval-alice'").run(new Date().toISOString());
  await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'share_project',approvalId:'approval-alice',inputHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}),e=>e.code==='AGENT_STEP_REFERENCE_REQUIRED');
 }finally{db.sql.close();}
});

test('sensitive approval cannot authorize a different persisted agent step',async()=>{
 const db=database();try{
  const now=new Date().toISOString();
  db.sql.prepare("UPDATE agent_approvals SET action_type='share_project',decision='approve',decided_at=? WHERE id='approval-alice'").run(now);
  db.sql.prepare("INSERT INTO agent_steps (id,run_id,sequence_no,tool_name,status,input_hash) VALUES ('step-share','run-alice',1,'share_project','awaiting_approval','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')").run();
  db.sql.prepare("INSERT INTO agent_steps (id,run_id,sequence_no,tool_name,status,input_hash) VALUES ('step-delete','run-alice',2,'delete_project','awaiting_approval','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')").run();
  assert.deepEqual(await authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'share_project',approvalId:'approval-alice',stepId:'step-share',inputHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}),{tool:'share_project',requiresApproval:true});
  await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'share_project',approvalId:'approval-alice',stepId:'step-delete',inputHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}),e=>e.code==='AGENT_TOOL_STEP_MISMATCH');
  await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'share_project',approvalId:'approval-alice',stepId:'missing-step',inputHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}),e=>e.code==='AGENT_TOOL_STEP_MISMATCH');
  await assert.rejects(authorizeAgentToolForRun(db,{runId:'run-alice',owner:'alice',toolName:'share_project',approvalId:'approval-alice',stepId:'step-share',inputHash:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}),e=>e.code==='AGENT_TOOL_INPUT_MISMATCH');
 }finally{db.sql.close();}
});

test('agent queue consumer claims once and duplicate delivery cannot execute twice',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued' WHERE id='run-alice'").run();
  const first=queueMessage({runId:'run-alice',owner:'alice'});await worker.queue({messages:[first]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(first.acked,1);assert.equal(first.retried,0);
  let row=db.sql.prepare("SELECT status,error_code FROM agent_runs WHERE id='run-alice'").get();assert.equal(row.status,'failed');assert.equal(row.error_code,'AGENT_RUNTIME_EXECUTION_NOT_CONNECTED');
  const duplicate=queueMessage({runId:'run-alice',owner:'alice'});await worker.queue({messages:[duplicate]},{...defaults,DB:db.DB});
  assert.equal(duplicate.acked,1);assert.equal(duplicate.retried,0);
  row=db.sql.prepare("SELECT status,error_code FROM agent_runs WHERE id='run-alice'").get();assert.equal(row.status,'failed');assert.equal(row.error_code,'AGENT_RUNTIME_EXECUTION_NOT_CONNECTED');
 }finally{db.sql.close();}
});
test('agent execution releases reservation before terminal failure state',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued' WHERE id='run-alice'").run();
  const message=queueMessage({runId:'run-alice',owner:'alice'});
  await worker.queue({messages:[message]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(message.acked,1);assert.equal(message.retried,0);
  const reservation=db.sql.prepare("SELECT status FROM usage_reservations WHERE owner_id='alice' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(reservation.status,'released');
  const run=db.sql.prepare("SELECT status,error_code FROM agent_runs WHERE id='run-alice'").get();
  assert.equal(run.status,'failed');
  assert.equal(run.error_code,'AGENT_RUNTIME_EXECUTION_NOT_CONNECTED');
 }finally{db.sql.close();}
});
test('agent queue consumer drops malformed, foreign-owner and terminal messages',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='completed' WHERE id='run-alice'").run();
  for(const message of [queueMessage({runId:'bad/id',owner:'alice'}),queueMessage({runId:'run-alice',owner:'bob'}),queueMessage({runId:'run-alice',owner:'alice'})]){
   await worker.queue({messages:[message]},{...defaults,DB:db.DB});assert.equal(message.acked,1);assert.equal(message.retried,0);
  }
  assert.equal(db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get().status,'completed');
 }finally{db.sql.close();}
});
test('agent queue consumer retries when database is unavailable',async()=>{
 const message=queueMessage({runId:'run-alice',owner:'alice'});await worker.queue({messages:[message]},{...defaults,DB:null});
 assert.equal(message.acked,0);assert.equal(message.retried,1);
});
test('health is public, but protected routes reject absent identity regardless of flags',async()=>{
 assert.equal((await call('/v1/health',{value:null})).status,200);
 for(const bindings of [{},{ENVIRONMENT:'development',AUTH_REQUIRED:'false'},{ENVIRONMENT:undefined,AUTH_REQUIRED:undefined}])assert.equal((await call('/v1/agents/runs/run-alice',{value:null,bindings})).status,401);
});
test('chat, agents and routing are disabled by default even for a valid user',async()=>{
 for(const path of ['/v1/chat/responses','/v1/agents/runs','/v1/ai/routes']){
  const response=await call(path,{method:'POST',body:{message:'hi'},bindings:{AGENT_EXECUTION_ENABLED:undefined}});
  assert.equal(response.status,503);assert.match((await response.json()).code,/DISABLED$/);
 }
});
test('another owner cannot read, cancel, or approve a run; spoofed UID header is ignored',async()=>{
 const db=database();try{
  for(const [path,method,body] of [['/v1/agents/runs/run-alice','GET'],['/v1/agents/runs/run-alice/cancel','POST'],['/v1/agents/runs/run-alice/approvals/approval-alice','POST',{decision:'approve'}]]){
   const response=await call(path,{method,body,value:bob,headers:{'x-uvenaro-verified-sub':'alice'},bindings:db});
   assert.equal(response.status,404);assert.equal((await response.json()).code,'NOT_FOUND');
  }
  assert.equal(db.sql.prepare('SELECT status FROM agent_runs').get().status,'awaiting_approval');
  assert.equal(db.sql.prepare('SELECT decision FROM agent_approvals').get().decision,'pending');
 }finally{db.sql.close();}
});
test('owner reads and cancels own run; repeated cancellation does not report success',async()=>{
 const db=database();try{
  assert.equal((await call('/v1/agents/runs/run-alice',{bindings:db})).status,200);
  assert.equal((await call('/v1/agents/runs/run-alice/cancel',{method:'POST',bindings:db})).status,202);
  assert.equal((await call('/v1/agents/runs/run-alice/cancel',{method:'POST',bindings:db})).status,409);
 }finally{db.sql.close();}
});
for(const state of ['completed','failed','cancelled','expired'])test(`terminal agent run ${state} cannot be cancelled`,async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status=? WHERE id='run-alice'").run(state);
  assert.equal((await call('/v1/agents/runs/run-alice/cancel',{method:'POST',bindings:db})).status,409);
  assert.equal(db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get().status,state);
 }finally{db.sql.close();}
});
test('malformed agent references fail closed without changing state',async()=>{
 const db=database();try{
  const bad='x'.repeat(129);
  assert.equal((await call('/v1/agents/runs/'+bad,{bindings:db})).status,400);
  assert.equal((await call('/v1/agents/runs/'+bad+'/cancel',{method:'POST',bindings:db})).status,400);
  assert.equal((await call('/v1/agents/runs/run-alice/approvals/'+bad,{method:'POST',body:{decision:'approve'},bindings:db})).status,400);
  assert.equal((await call('/v1/agents/runs/'+bad+'/approvals/approval-alice',{method:'POST',body:{decision:'approve'},bindings:db})).status,400);
  assert.equal(db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get().status,'awaiting_approval');
  assert.equal(db.sql.prepare("SELECT decision FROM agent_approvals WHERE id='approval-alice'").get().decision,'pending');
 }finally{db.sql.close();}
});
test('owner approval is recorded once and replay rejected',async()=>{
 const db=database();try{
  const options={method:'POST',body:{decision:'approve'},bindings:db};
  assert.equal((await call('/v1/agents/runs/run-alice/approvals/approval-alice',options)).status,200);
  assert.equal((await call('/v1/agents/runs/run-alice/approvals/approval-alice',options)).status,409);
  assert.equal(db.sql.prepare('SELECT decision FROM agent_approvals').get().decision,'approve');
 }finally{db.sql.close();}
});
test('cancellation invalidates a pending approval before it can be accepted',async()=>{
 const db=database();try{
  assert.equal((await call('/v1/agents/runs/run-alice/cancel',{method:'POST',bindings:db})).status,202);
  assert.equal((await call('/v1/agents/runs/run-alice/approvals/approval-alice',{method:'POST',body:{decision:'approve'},bindings:db})).status,409);
  assert.equal(db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get().status,'cancelled');
  assert.equal(db.sql.prepare("SELECT decision FROM agent_approvals WHERE id='approval-alice'").get().decision,'pending');
 }finally{db.sql.close();}
});
for(const [name,mutation] of Object.entries({'expired approval':"UPDATE agent_approvals SET expires_at='2000-01-01T00:00:00Z'",'invalid expiry':"UPDATE agent_approvals SET expires_at='nonsense'",'cancelled run':"UPDATE agent_runs SET status='cancelled'",'running run':"UPDATE agent_runs SET status='running'"}))test(`${name} cannot be approved`,async()=>{
 const db=database();try{
  db.sql.exec(mutation);
  assert.equal((await call('/v1/agents/runs/run-alice/approvals/approval-alice',{method:'POST',body:{decision:'approve'},bindings:db})).status,409);
  assert.equal(db.sql.prepare('SELECT decision FROM agent_approvals').get().decision,'pending');
 }finally{db.sql.close();}
});
test('database trigger enforces two active agent runs per owner',()=>{
 const db=database();try{
  const now=new Date().toISOString();
  db.sql.prepare('INSERT INTO agent_runs (id,owner_id,status,objective,payload_json,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?)').run('run-alice-2','alice','queued','second','{}',now,now,'key-alice-2');
  assert.throws(()=>db.sql.prepare('INSERT INTO agent_runs (id,owner_id,status,objective,payload_json,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?)').run('run-alice-3','alice','queued','third','{}',now,now,'key-alice-3'),/AGENT_CONCURRENCY_LIMIT_REACHED/);
  db.sql.prepare("UPDATE agent_runs SET status='completed' WHERE id='run-alice'").run();
  assert.doesNotThrow(()=>db.sql.prepare('INSERT INTO agent_runs (id,owner_id,status,objective,payload_json,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?)').run('run-alice-3','alice','queued','third','{}',now,now,'key-alice-3'));
 }finally{db.sql.close();}
});
test('inactive run cannot be reactivated past the active-agent cap',()=>{
 const db=database();try{
  const now=new Date().toISOString();
  db.sql.prepare('INSERT INTO agent_runs (id,owner_id,status,objective,payload_json,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?)').run('run-alice-2','alice','queued','second','{}',now,now,'key-alice-2');
  db.sql.prepare('INSERT INTO agent_runs (id,owner_id,status,objective,payload_json,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?)').run('run-alice-3','alice','completed','third','{}',now,now,'key-alice-3');
  assert.throws(()=>db.sql.prepare("UPDATE agent_runs SET status='running' WHERE id='run-alice-3'").run(),/AGENT_CONCURRENCY_LIMIT_REACHED/);
 }finally{db.sql.close();}
});
test('agent idempotency key cannot be reused for a different objective',async()=>{
 const db=database();let sends=0;const bindings={...db,AGENT_QUEUE:{async send(){sends++;}}};const key='same-agent-key',nonce=()=>crypto.randomUUID().replaceAll('-','');
 try{
  const first=await call('/v1/agents/runs',{method:'POST',body:{objective:'  create safe report  '},headers:{'idempotency-key':key,'x-uvenaro-nonce':nonce()},bindings});
  assert.equal(first.status,202);assert.equal((await first.json()).objective,'create safe report');assert.equal(sends,1);
  const retry=await call('/v1/agents/runs',{method:'POST',body:{objective:'create safe report'},headers:{'idempotency-key':key,'x-uvenaro-nonce':nonce()},bindings});
  assert.equal(retry.status,200);assert.equal(sends,1);
  const conflict=await call('/v1/agents/runs',{method:'POST',body:{objective:'different objective'},headers:{'idempotency-key':key,'x-uvenaro-nonce':nonce()},bindings});
  assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'IDEMPOTENCY_CONFLICT');assert.equal(sends,1);
 }finally{db.sql.close();}
});
test('agent create rejects client policy and limits before queueing',async()=>{
 const db=database();let sends=0;const bindings={...db,AGENT_QUEUE:{async send(){sends++;}}};
 try{
  for(const body of [{objective:'x',limits:{maxSteps:999999}},{objective:'x',policy:{allowAll:true}}]){
   const response=await call('/v1/agents/runs',{method:'POST',body,headers:{'idempotency-key':crypto.randomUUID().replaceAll('-',''),'x-uvenaro-nonce':crypto.randomUUID().replaceAll('-','')},bindings});
   assert.equal(response.status,400);assert.equal((await response.json()).code,'SERVER_POLICY_REQUIRED');
  }
  assert.equal(sends,0);
 }finally{db.sql.close();}
});
test('queue dispatch failure is fail-closed and releases active capacity',async()=>{
 const db=database();const bindings={...db,AGENT_QUEUE:{async send(){throw new Error('queue secret outage');}}};
 try{
  db.sql.prepare("UPDATE agent_runs SET status='completed' WHERE id='run-alice'").run();
  const response=await call('/v1/agents/runs',{method:'POST',body:{objective:'dispatch me'},headers:{'idempotency-key':'queue-failure-key','x-uvenaro-nonce':crypto.randomUUID().replaceAll('-','')},bindings});
  assert.equal(response.status,503);assert.equal((await response.json()).code,'AGENT_QUEUE_UNAVAILABLE');
  const row=db.sql.prepare("SELECT status,error_code FROM agent_runs WHERE owner_id='alice' AND idempotency_key='queue-failure-key'").get();
  assert.equal(row.status,'failed');assert.equal(row.error_code,'QUEUE_DISPATCH_FAILED');
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE owner_id='alice' AND status IN ('queued','planning','running','awaiting_approval')").get().n,0);
 }finally{db.sql.close();}
});
test('missing database or queue cannot produce false successful writes',async()=>{
 assert.equal((await call('/v1/agents/runs',{method:'POST',body:{objective:'test'}})).status,503);
 assert.equal((await call('/v1/agents/runs/run-alice/approvals/approval-alice',{method:'POST',body:{decision:'approve'},bindings:{DB:undefined}})).status,503);
});
test('allowed-origin success and errors consistently include CORS; other origins rejected',async()=>{
 for(const value of [alice,null]){
  const response=await call('/v1/agents/runs/run-alice',{value,headers:{origin:'https://uvenaro.com'}});
  assert.equal(response.headers.get('access-control-allow-origin'),'https://uvenaro.com');
  assert.equal(response.headers.get('access-control-allow-credentials'),'true');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
 for(const origin of ['https://evil.invalid','null'])assert.equal((await call('/v1/health',{headers:{origin}})).status,403);
});
test('rejected async database promise becomes a generic error, without leaked details',async()=>{
 const response=await call('/v1/agents/runs/run-alice',{bindings:{DB:{prepare(){throw new Error('secret database credentials');}}},headers:{origin:'https://uvenaro.com'}});
 assert.equal(response.status,500);assert.doesNotMatch(await response.text(),/secret/);
 assert.equal(response.headers.get('access-control-allow-origin'),'https://uvenaro.com');
});
for(const [name,body,headers,status] of [
 ['oversized streamed body','x'.repeat(65537),{},413],['malformed JSON','{',{},400],
 ['array JSON','[]',{},400],['incorrect media type','{}',{'content-type':'text/plain'},415]
])test(`rejects ${name} before database/provider work`,async()=>{
 const response=await call('/v1/ai/routes',{method:'POST',body,headers,bindings:{MODEL_ROUTING_ENABLED:'true'}});assert.equal(response.status,status);
});
test('preflight succeeds without contacting identity service',async()=>{
 const response=await call('/v1/chat/responses',{method:'OPTIONS',value:null,headers:{origin:'https://uvenaro.com'}});
 assert.equal(response.status,204);assert.match(response.headers.get('access-control-allow-headers'),/authorization/);
});

// Agent runtime configuration must fail closed before any database/provider work.
test('agent runtime configuration rejects missing provider/model and invalid hard limits',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued' WHERE id='run-alice'").run();
  for(const bindings of [
   {AGENT_PROVIDER:'',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'},
   {AGENT_PROVIDER:'test-provider',AGENT_MODEL:'',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'},
   {AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_MAX_STEPS:'0',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'},
   {AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_MAX_RUNTIME_MS:'999999999',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'},
   {AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'0'}
  ]){
   const message=queueMessage({runId:'run-alice',owner:'alice'});
   await worker.queue({messages:[message]},{...defaults,DB:db.DB,...bindings});
   assert.equal(message.acked,0);assert.equal(message.retried,1);
   assert.equal(db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get().status,'queued');
  }
 }finally{db.sql.close();}
});

test('stale queued agent work is not claimed or billed',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued',updated_at='2000-01-01T00:00:00Z' WHERE id='run-alice'").run();
  const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
  const message=queueMessage({runId:'run-alice',owner:'alice'});
  await worker.queue({messages:[message]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(message.acked,1);assert.equal(message.retried,0);
  const row=db.sql.prepare("SELECT status,error_code FROM agent_runs WHERE id='run-alice'").get();
  assert.equal(row.status,'expired');assert.equal(row.error_code,'AGENT_QUEUE_STALE');
  const after=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;assert.equal(after,before);
 }finally{db.sql.close();}
});

test('malformed queued agent timestamp expires without billing',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued',updated_at='not-a-timestamp' WHERE id='run-alice'").run();
  const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
  const message=queueMessage({runId:'run-alice',owner:'alice'});
  await worker.queue({messages:[message]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(message.acked,1);assert.equal(message.retried,0);
  const row=db.sql.prepare("SELECT status,error_code FROM agent_runs WHERE id='run-alice'").get();
  assert.equal(row.status,'expired');assert.equal(row.error_code,'AGENT_QUEUE_STALE');
  const after=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;assert.equal(after,before);
 }finally{db.sql.close();}
});

test('duplicate agent queue delivery cannot reserve budget twice',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued',objective='safe',idempotency_key='safe-key',error_code=NULL,updated_at=? WHERE id='run-alice'").run(new Date().toISOString());
  const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
  const first=queueMessage({runId:'run-alice',owner:'alice'});
  await worker.queue({messages:[first]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(first.acked,1);assert.equal(first.retried,0);
  const afterFirst=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
  assert.equal(afterFirst,before+1);
  const firstReservation=db.sql.prepare("SELECT status FROM usage_reservations WHERE owner_id='alice' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(firstReservation.status,'released');
  const second=queueMessage({runId:'run-alice',owner:'alice'});
  await worker.queue({messages:[second]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(second.acked,1);assert.equal(second.retried,0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n,afterFirst);
 }finally{db.sql.close();}
});

test('concurrent duplicate agent deliveries create at most one reservation',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued',objective='safe',idempotency_key='concurrent-safe-key',error_code=NULL,updated_at=? WHERE id='run-alice'").run(new Date().toISOString());
  const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
  const first=queueMessage({runId:'run-alice',owner:'alice'}),second=queueMessage({runId:'run-alice',owner:'alice'});
  const bindings={...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'};
  await Promise.all([worker.queue({messages:[first]},bindings),worker.queue({messages:[second]},bindings)]);
  assert.equal(first.acked+second.acked,2);assert.equal(first.retried+second.retried,0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n,before+1);
  const reservation=db.sql.prepare("SELECT status FROM usage_reservations WHERE owner_id='alice' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(reservation.status,'released');
 }finally{db.sql.close();}
});

test('concurrent duplicate agent deliveries preserve one terminal outcome',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued',objective='safe',idempotency_key='concurrent-terminal-key',error_code=NULL,updated_at=? WHERE id='run-alice'").run(new Date().toISOString());
  const first=queueMessage({runId:'run-alice',owner:'alice'}),second=queueMessage({runId:'run-alice',owner:'alice'});
  const bindings={...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'};
  await Promise.all([worker.queue({messages:[first]},bindings),worker.queue({messages:[second]},bindings)]);
  const run=db.sql.prepare("SELECT status,error_code FROM agent_runs WHERE id='run-alice'").get();
  assert.equal(run.status,'failed');assert.equal(run.error_code,'AGENT_RUNTIME_EXECUTION_NOT_CONNECTED');
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice' AND status='reserved'").get().n,0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n,1);
 }finally{db.sql.close();}
});

test('concurrent cancellation and execution never leave reserved agent budget',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued',objective='safe',idempotency_key='cancel-execution-race-key',error_code=NULL,updated_at=? WHERE id='run-alice'").run(new Date().toISOString());
  const message=queueMessage({runId:'run-alice',owner:'alice'});
  const bindings={...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'};
  await Promise.all([
   worker.queue({messages:[message]},bindings),
   call('/v1/agents/runs/run-alice/cancel',{method:'POST',bindings})
  ]);
  const run=db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get();
  assert.ok(['failed','cancelled'].includes(run.status));
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice' AND status='reserved'").get().n,0);
  const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
  const redelivery=queueMessage({runId:'run-alice',owner:'alice'});
  await worker.queue({messages:[redelivery]},bindings);
  assert.equal(redelivery.acked,1);assert.equal(redelivery.retried,0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n,before);
 }finally{db.sql.close();}
});

test('concurrent cancellation and execution preserve a single terminal outcome across repeated races',async()=>{
 for(let i=0;i<8;i++){
  const db=database();try{
   db.sql.prepare("UPDATE agent_runs SET status='queued',objective='safe',idempotency_key=?,error_code=NULL,updated_at=? WHERE id='run-alice'").run('cancel-race-'+i,new Date().toISOString());
   const message=queueMessage({runId:'run-alice',owner:'alice'});
   const bindings={...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'};
   await Promise.all([
    worker.queue({messages:[message]},bindings),
    call('/v1/agents/runs/run-alice/cancel',{method:'POST',bindings})
   ]);
   const run=db.sql.prepare("SELECT status,error_code FROM agent_runs WHERE id='run-alice'").get();
   assert.ok(['failed','cancelled'].includes(run.status));
   if(run.status==='failed')assert.equal(run.error_code,'AGENT_RUNTIME_EXECUTION_NOT_CONNECTED');
   assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice' AND status='reserved'").get().n,0);
   assert.ok(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n<=1);
  }finally{db.sql.close();}
 }
});

test('agent queue delivery with wrong owner is acknowledged without billing or state change',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued',objective='safe',idempotency_key='safe-key',error_code=NULL,updated_at=? WHERE id='run-alice'").run(new Date().toISOString());
  const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations").get().n;
  const message=queueMessage({runId:'run-alice',owner:'mallory'});
  await worker.queue({messages:[message]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(message.acked,1);assert.equal(message.retried,0);
  const run=db.sql.prepare("SELECT status,owner_id FROM agent_runs WHERE id='run-alice'").get();
  assert.equal(run.status,'queued');assert.equal(run.owner_id,'alice');
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations").get().n,before);
 }finally{db.sql.close();}
});

test('malformed agent queue deliveries are acknowledged before database or billing work',async()=>{
 const poison=[
  {},{runId:'bad/id',owner:'alice'},{runId:'run-alice',owner:''},
  {runId:'run-alice',owner:'x'.repeat(129)}
 ];
 for(const payload of poison){
  let prepared=0;
  const DB={prepare(){prepared++;throw new Error('database must not be touched');}};
  const message=queueMessage(payload);
  await worker.queue({messages:[message]},{...defaults,DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(message.acked,1);assert.equal(message.retried,0);assert.equal(prepared,0);
 }
});

test('unknown agent queue delivery is acknowledged without billing',async()=>{
 const db=database();try{
  const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations").get().n;
  const message=queueMessage({runId:'missing-run',owner:'alice'});
  await worker.queue({messages:[message]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(message.acked,1);assert.equal(message.retried,0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations").get().n,before);
 }finally{db.sql.close();}
});

test('terminal agent queue redeliveries are acknowledged without billing',async()=>{
 const terminal=['completed','failed','cancelled','expired'];
 const db=database();try{
  for(const status of terminal){
   db.sql.prepare("UPDATE agent_runs SET status=?,objective='safe',idempotency_key='safe-key',error_code=NULL,updated_at=? WHERE id='run-alice'").run(status,new Date().toISOString());
   const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
   const message=queueMessage({runId:'run-alice',owner:'alice'});
   await worker.queue({messages:[message]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
   assert.equal(message.acked,1);assert.equal(message.retried,0);
   assert.equal(db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get().status,status);
   assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n,before);
  }
 }finally{db.sql.close();}
});

test('non-queued active agent redeliveries cannot reserve budget again',async()=>{
 const active=['planning','running','awaiting_approval'];
 const db=database();try{
  for(const status of active){
   db.sql.prepare("UPDATE agent_runs SET status=?,objective='safe',idempotency_key='safe-key',error_code=NULL,updated_at=? WHERE id='run-alice'").run(status,new Date().toISOString());
   const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
   const message=queueMessage({runId:'run-alice',owner:'alice'});
   await worker.queue({messages:[message]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
   assert.equal(message.acked,1);assert.equal(message.retried,0);
   assert.equal(db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get().status,status);
   assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n,before);
  }
 }finally{db.sql.close();}
});

test('agent queue database lookup failure retries without billing',async()=>{
 let prepared=0;
 const DB={prepare(){
  prepared++;
  return {bind(){return {first:async()=>{throw new Error('database unavailable');}}}};
 }};
 const message=queueMessage({runId:'run-alice',owner:'alice'});
 await worker.queue({messages:[message]},{...defaults,DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
 assert.equal(message.acked,0);assert.equal(message.retried,1);assert.equal(prepared,1);
});

test('agent queue owner lookup mismatch fails closed before execution',async()=>{
 let calls=0;
 const DB={prepare(sql){
  calls++;
  if(!String(sql).includes('SELECT status,owner_id AS owner FROM agent_runs'))throw new Error('unexpected database access');
  return {bind(){return {first:async()=>({status:'queued',owner:'mallory'})}}};
 }};
 const message=queueMessage({runId:'run-alice',owner:'alice'});
 await worker.queue({messages:[message]},{...defaults,DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
 assert.equal(message.acked,1);assert.equal(message.retried,0);assert.equal(calls,1);
});

test('agent queue lookup of a non-terminal non-queued state cannot trigger billing',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='planning',objective='safe',idempotency_key='safe-key',error_code=NULL,updated_at=? WHERE id='run-alice'").run(new Date().toISOString());
  const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
  const message=queueMessage({runId:'run-alice',owner:'alice'});
  await worker.queue({messages:[message]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
  assert.equal(message.acked,1);assert.equal(message.retried,0);
  assert.equal(db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get().status,'planning');
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n,before);
 }finally{db.sql.close();}
});

test('concurrent cancellation cannot resurrect quarantined agent work',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued',objective='',idempotency_key='quarantine-race-key',error_code=NULL,updated_at=? WHERE id='run-alice'").run(new Date().toISOString());
  const message=queueMessage({runId:'run-alice',owner:'alice'});
  const bindings={...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'};
  await Promise.all([
   worker.queue({messages:[message]},bindings),
   call('/v1/agents/runs/run-alice/cancel',{method:'POST',bindings})
  ]);
  const run=db.sql.prepare("SELECT status FROM agent_runs WHERE id='run-alice'").get();
  assert.ok(['failed','cancelled'].includes(run.status));
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n,0);
  const redelivery=queueMessage({runId:'run-alice',owner:'alice'});
  await worker.queue({messages:[redelivery]},bindings);
  assert.equal(redelivery.acked,1);assert.equal(redelivery.retried,0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n,0);
 }finally{db.sql.close();}
});

test('tampered persisted agent input cannot reach budget reservation',async()=>{
 const db=database();try{
  for(const [field,value] of [['objective',''],['objective','x'.repeat(4001)],['idempotency_key','bad/key']]){
   db.sql.prepare("UPDATE agent_runs SET status='queued',objective='safe',idempotency_key='safe-key',updated_at=? WHERE id='run-alice'").run(new Date().toISOString());
   db.sql.prepare(`UPDATE agent_runs SET ${field}=? WHERE id='run-alice'`).run(value);
   const before=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;
   const message=queueMessage({runId:'run-alice',owner:'alice'});
   await worker.queue({messages:[message]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
   assert.equal(message.acked,0);assert.equal(message.retried,1);
   const quarantined=db.sql.prepare("SELECT status,error_code FROM agent_runs WHERE id='run-alice'").get();
   assert.equal(quarantined.status,'failed');assert.equal(quarantined.error_code,'AGENT_PERSISTED_INPUT_INVALID');
   const redelivery=queueMessage({runId:'run-alice',owner:'alice'});
   await worker.queue({messages:[redelivery]},{...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'});
   assert.equal(redelivery.acked,1);assert.equal(redelivery.retried,0);
   const after=db.sql.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE owner_id='alice'").get().n;assert.equal(after,before);
  }
 }finally{db.sql.close();}
});

test('agent audit trail records authoritative transitions and is immutable',async()=>{
 const db=database();try{
  db.sql.prepare("UPDATE agent_runs SET status='queued',error_code=NULL,updated_at=? WHERE id='run-alice'").run(new Date().toISOString());
  const bindings={...defaults,DB:db.DB,AGENT_PROVIDER:'test-provider',AGENT_MODEL:'test-model',AGENT_GLOBAL_DAILY_COST_MICROUSD:'1000000'};
  const message=queueMessage({runId:'run-alice',owner:'alice'});
  await worker.queue({messages:[message]},bindings);
  const events=db.sql.prepare("SELECT event_type,from_state,to_state,owner_id,run_id FROM agent_audit_events WHERE run_id='run-alice' ORDER BY rowid").all();
  assert.ok(events.some(e=>e.event_type==='claimed'&&e.from_state==='queued'&&e.to_state==='planning'));
  assert.ok(events.some(e=>e.event_type==='runtime_failed'&&e.from_state==='planning'&&e.to_state==='failed'));
  assert.ok(events.every(e=>e.owner_id==='alice'&&e.run_id==='run-alice'));
  const id=db.sql.prepare("SELECT id FROM agent_audit_events WHERE run_id='run-alice' LIMIT 1").get().id;
  assert.throws(()=>db.sql.prepare("UPDATE agent_audit_events SET owner_id='bob' WHERE id=?").run(id),/AGENT_AUDIT_IMMUTABLE/);
  assert.throws(()=>db.sql.prepare("DELETE FROM agent_audit_events WHERE id=?").run(id),/AGENT_AUDIT_IMMUTABLE/);
 }finally{db.sql.close();}
});

test('rejected approval replay does not create a second audit event',async()=>{
 const db=database();try{
  const bindings={...defaults,...db};
  assert.equal((await call('/v1/agents/runs/run-alice/approvals/approval-alice',{method:'POST',body:{decision:'approve'},bindings})).status,200);
  assert.equal((await call('/v1/agents/runs/run-alice/approvals/approval-alice',{method:'POST',body:{decision:'approve'},bindings})).status,409);
  const events=db.sql.prepare("SELECT event_type,approval_id,decision,owner_id FROM agent_audit_events WHERE approval_id='approval-alice'").all();
  assert.equal(events.length,1);assert.equal(events[0].event_type,'approval_decided');assert.equal(events[0].decision,'approve');assert.equal(events[0].owner_id,'alice');
 }finally{db.sql.close();}
});
