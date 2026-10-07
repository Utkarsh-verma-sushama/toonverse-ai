import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateProvisionRequest,provisioningPlan,provisionIsolatedDatabases} from './provision-isolated-databases.mjs';
import {stagingNames} from './inspect-isolated-staging.mjs';
const now=Date.parse('2026-10-07T07:00:00Z'),account='a'.repeat(32),pilot='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const request={protocol:'uvenaro-empty-staging-databases-v1',operationId:'isolated-databases-test-request',repository:'Utkarsh-verma-sushama/toonverse-ai',
 accountId:account,allowedAction:'create-three-empty-d1-databases-only',createdAt:'2026-10-07T06:54:00Z',expiresAt:'2026-10-07T12:52:00Z',
 ownerPlanEvidence:{source:'owner-dashboard-screenshots',accountId:account,observedAt:'2026-10-07T06:52:00Z',plan:'Workers Free',price:0,currentPlan:true,
 screenshots:['1000053856.jpg','1000053857.jpg'],accountContextScreenshots:['1000053854.jpg','1000053855.jpg']}};
const env={GITHUB_REPOSITORY:request.repository,GITHUB_REF:'refs/heads/main',GITHUB_SHA:'c'.repeat(40),GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1',
 GITHUB_TOKEN:'fixture-github-secret',CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'fixture-cloudflare-secret',UVENARO_STAGING_DATABASE_ID:pilot};
const report={readyForProvisioning:false,workersFreePlanVerified:false,blockers:['WORKERS_FREE_PLAN_UNVERIFIED'],subscriptionCount:0,
 freePlanHttpStatus:null,freePlanApiErrorCodes:[],freePlanMetadataError:'SUBSCRIPTION_INVENTORY_INCOMPLETE'};
function fixture(){
 const dbs=[{name:'uvenaro-account-staging',uuid:pilot}],calls=[],snapshots=[];let ciCalls=0;
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname;calls.push({path,method:options.method,body:options.body});
  assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer fixture-cloudflare-secret');
  if(path.endsWith('/workers/services'))return Response.json({success:true,result:[]});
  if(path.endsWith('/d1/database')&&options.method==='GET')return Response.json({success:true,result:dbs,result_info:{total_count:dbs.length}});
  if(options.method==='POST'){
   const payload=JSON.parse(options.body);assert.deepEqual(Object.keys(payload),['name','primary_location_hint','read_replication']);
   assert.equal(payload.primary_location_hint,'apac');assert.deepEqual(payload.read_replication,{mode:'disabled'});
   const digit=String(dbs.length+3),uuid=[digit.repeat(8),digit.repeat(4),digit.repeat(4),digit.repeat(4),digit.repeat(12)].join('-');
   const db={name:payload.name,uuid};dbs.push(db);return Response.json({success:true,result:db});
  }
  const found=dbs.find(d=>path.endsWith('/'+d.uuid));if(found)return Response.json({success:true,result:found});
  throw Error('Unexpected fixture operation');
 };
 return {dbs,calls,snapshots,options:{env,request,now:()=>now,fetcher,inspect:async()=>report,ciCheck:async()=>{ciCalls++;},save:async s=>snapshots.push(structuredClone(s))},get ciCalls(){return ciCalls;}};
}
test('same-account owner proof resolves only successful empty subscription metadata without changing API proof',()=>{
 assert.deepEqual(provisioningPlan(report,request,env,now),{source:'owner-dashboard-screenshots',apiWorkersFreePlanVerified:false});
 assert.deepEqual(provisioningPlan({...report,readyForProvisioning:true,workersFreePlanVerified:true,blockers:[]},request,env,now),{source:'cloudflare-subscription-api'});
 assert.equal(report.workersFreePlanVerified,false);
});
test('paid, partial nonempty, denied, missing scope and failed inventory remain blocked',()=>{
 for(const change of [{subscriptionCount:1},{freePlanHttpStatus:403},{freePlanApiErrorCodes:[1000]},
  {freePlanMetadataError:'METADATA_CHECK_FAILED'},{blockers:['TOKEN_SCOPE_METADATA_UNAVAILABLE','WORKERS_FREE_PLAN_UNVERIFIED']},
  {blockers:['WORKERS_FREE_PLAN_UNVERIFIED','FREE_DATABASE_CAPACITY_UNAVAILABLE']}])assert.throws(()=>provisioningPlan({...report,...change},request,env,now),/CLOUDFLARE_PREFLIGHT_BLOCKED/);
});
test('wrong account, expired/future evidence, paid price and unrelated screenshots cannot grant provisioning',()=>{
 for(const change of [{accountId:'b'.repeat(32)},{expiresAt:'2026-10-07T06:59:00Z'},{expiresAt:'2026-10-08T12:52:00Z'},
  {createdAt:'2026-10-07T07:01:00Z'},{ownerPlanEvidence:{...request.ownerPlanEvidence,accountId:'b'.repeat(32)}},
  {ownerPlanEvidence:{...request.ownerPlanEvidence,price:5}},{ownerPlanEvidence:{...request.ownerPlanEvidence,screenshots:['../../secret']}}])assert.throws(()=>validateProvisionRequest({...request,...change},env,now));
});
test('creates and reads back exactly three distinct empty databases with durable intent and untouched pilot',async()=>{
 const f=fixture(),state=await provisionIsolatedDatabases(f.options);
 assert.equal(state.status,'verified-three-empty-databases');assert.equal(state.writePermissionsExercised,true);assert.equal(state.workerSourceUploaded,false);
 assert.equal(state.sqlUploaded,false);assert.equal(state.providerRequestsPerformed,false);assert.equal(state.pending,null);
 assert.deepEqual(state.created.map(d=>d.name),stagingNames.databases);assert.equal(new Set(state.created.map(d=>d.uuid)).size,3);
 assert.equal(f.dbs[0].uuid,pilot);assert.equal(f.ciCalls,5);assert.equal(f.calls.filter(c=>c.method==='POST').length,3);
 assert.ok(f.calls.every(c=>['GET','POST'].includes(c.method)));assert.ok(f.calls.filter(c=>c.method==='POST').every(c=>c.path.endsWith('/d1/database')));
 for(const name of stagingNames.databases)assert.ok(f.snapshots.some(s=>s.pending?.name===name&&s.pending.outcome==='unknown-no-retry'));
 assert.doesNotMatch(JSON.stringify(state),/fixture-github-secret|fixture-cloudflare-secret/);
});
test('failed exact-main CI produces no Cloudflare operation or leaked diagnostics',async()=>{
 const f=fixture();f.options.ciCheck=async()=>{throw Error('Release blocked: fixture-github-secret');};
 await assert.rejects(provisionIsolatedDatabases(f.options),/PROVISIONING_GATE_FAILED/);assert.equal(f.calls.length,0);assert.doesNotMatch(JSON.stringify(f.snapshots),/fixture-github-secret/);
});
test('main drift after one successful creation retains identity and prevents further writes',async()=>{
 const f=fixture();let checks=0;f.options.ciCheck=async()=>{if(++checks===3)throw Error('main drift');};
 await assert.rejects(provisionIsolatedDatabases(f.options),/PROVISIONING_GATE_FAILED/);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.snapshots.at(-1).created.length,1);
});
test('rerun, PR and foreign repository cannot create resources',async()=>{
 for(const change of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REF:'refs/pull/1/merge'},{GITHUB_REPOSITORY:'foreign/repo'}]){
  const f=fixture();f.options.env={...env,...change};await assert.rejects(provisionIsolatedDatabases(f.options));assert.equal(f.calls.length,0);
 }
});
test('preexisting target names are never silently adopted',async()=>{
 const f=fixture();f.dbs.push({name:stagingNames.databases[0],uuid:'44444444-4444-4444-4444-444444444444'});
 await assert.rejects(provisionIsolatedDatabases(f.options),/FRESH_DATABASE_INVENTORY_BLOCKED/);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('partial inventory cannot prove capacity',async()=>{
 const f=fixture(),original=f.options.fetcher;
 f.options.fetcher=async(url,options)=>String(url).includes('/d1/database?')?Response.json({success:true,result:f.dbs,result_info:{total_count:9}}):original(url,options);
 await assert.rejects(provisionIsolatedDatabases(f.options),/DATABASE_INVENTORY_INCOMPLETE/);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('lost create response is journaled as unknown and never retried or deleted',async()=>{
 const f=fixture(),original=f.options.fetcher;let posts=0;
 f.options.fetcher=async(url,options)=>{if(options.method==='POST'){posts++;throw Error('fixture-cloudflare-secret');}return original(url,options);};
 await assert.rejects(provisionIsolatedDatabases(f.options),/DATABASE_CREATE_OUTCOME_UNKNOWN_NO_RETRY/);assert.equal(posts,1);
 assert.equal(f.snapshots.at(-1).pending.name,stagingNames.databases[0]);assert.equal(f.snapshots.at(-1).status,'stopped-review-required');assert.doesNotMatch(JSON.stringify(f.snapshots),/fixture-cloudflare-secret/);
});
test('API reject/error bodies stop once and never leak private response bodies',async()=>{
 for(const reply of [()=>new Response('fixture-cloudflare-secret',{status:403}),()=>Response.json({success:false,errors:[{message:'fixture-cloudflare-secret'}]})]){
  const f=fixture(),original=f.options.fetcher;let posts=0;f.options.fetcher=async(url,options)=>options.method==='POST'?(posts++,reply()):original(url,options);
  await assert.rejects(provisionIsolatedDatabases(f.options),/DATABASE_CREATE_OUTCOME_UNKNOWN_NO_RETRY/);assert.equal(posts,1);assert.doesNotMatch(JSON.stringify(f.snapshots),/fixture-cloudflare-secret/);
 }
});
test('first identity readback mismatch stops second creation',async()=>{
 const f=fixture(),original=f.options.fetcher;
 f.options.fetcher=async(url,options)=>new URL(url).pathname.endsWith('/44444444-4444-4444-4444-444444444444')?Response.json({success:true,result:{uuid:'44444444-4444-4444-4444-444444444444',name:'foreign'}}):original(url,options);
 await assert.rejects(provisionIsolatedDatabases(f.options),/DATABASE_READBACK_IDENTITY_MISMATCH/);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.snapshots.at(-1).created.length,1);
});
test('pilot alias create response stays unknown and is never used for subsequent writes',async()=>{
 const f=fixture(),original=f.options.fetcher;
 f.options.fetcher=async(url,options)=>options.method==='POST'?Response.json({success:true,result:{name:stagingNames.databases[0],uuid:pilot}}):original(url,options);
 await assert.rejects(provisionIsolatedDatabases(f.options),/DATABASE_CREATE_IDENTITY_INVALID_NO_RETRY/);assert.equal(f.snapshots.at(-1).pending.name,stagingNames.databases[0]);assert.equal(f.snapshots.at(-1).created.length,0);
});
test('external concurrent inventory changes halt further creation',async()=>{
 const f=fixture(),original=f.options.fetcher;let injected=false;
 f.options.fetcher=async(url,options)=>{if(f.dbs.length===2&&!injected){f.dbs.push({name:'concurrent-resource',uuid:'99999999-9999-9999-9999-999999999999'});injected=true;}return original(url,options);};
 await assert.rejects(provisionIsolatedDatabases(f.options),/DATABASE_INVENTORY_CHANGED/);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('failed durable intent storage prevents the first POST',async()=>{
 const f=fixture();f.options.save=async state=>{if(state.pending)throw Error('disk unavailable');};await assert.rejects(provisionIsolatedDatabases(f.options));assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('owner proof expiring mid-operation stops the next create',async()=>{
 const f=fixture();let time=now;f.options.now=()=>time;const original=f.options.fetcher;
 f.options.fetcher=async(url,options)=>{const response=await original(url,options);if(options.method==='POST')time=Date.parse(request.expiresAt);return response;};
 await assert.rejects(provisionIsolatedDatabases(f.options),/OWNER_PLAN_EVIDENCE_EXPIRED_OR_INVALID/);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('request-specific first-attempt workflow retains journal on failure and contains no source deployment',()=>{
 const source=readFileSync(new URL('../.github/workflows/isolated-databases.yml',import.meta.url),'utf8');
 assert.match(source,/deploy\/isolated-staging\/provision-request\.json/);assert.match(source,/github\.run_attempt == 1/);assert.match(source,/if: always\(\)/);assert.match(source,/cancel-in-progress: false/);
 assert.doesNotMatch(source,/workflow_run:|wrangler|contents: write|sql execute|worker deploy/);
});
