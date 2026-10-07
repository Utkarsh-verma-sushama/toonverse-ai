import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {boundedJson} from '../backend/metered-gateway.mjs';
import {inspectIsolatedStaging,inventoryPlan,stagingNames} from './inspect-isolated-staging.mjs';
import {checkReleaseCi} from './check-release-ci.mjs';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const repository='Utkarsh-verma-sushama/toonverse-ai';
const fail=code=>{throw Error(code);};

export function validateProvisionRequest(request,env,now=Date.now()){
 const evidence=request?.ownerPlanEvidence;
 const created=Date.parse(request?.createdAt),expires=Date.parse(request?.expiresAt),observed=Date.parse(evidence?.observedAt);
 if(request?.protocol!=='uvenaro-empty-staging-databases-v1'||request.repository!==repository||env.GITHUB_REPOSITORY!==repository||
  request.allowedAction!=='create-three-empty-d1-databases-only'||!/^[a-z0-9-]{10,100}$/.test(request.operationId||'')||
  !/^[a-f0-9]{32}$/.test(request.accountId||'')||request.accountId!==env.CLOUDFLARE_ACCOUNT_ID)fail('PROVISION_REQUEST_INVALID');
 if(![created,expires,observed,now].every(Number.isFinite)||created>now||observed>created||now>=expires||expires-observed>6*3600000||created-observed>3600000)fail('OWNER_PLAN_EVIDENCE_EXPIRED_OR_INVALID');
 if(evidence?.source!=='owner-dashboard-screenshots'||evidence.accountId!==request.accountId||evidence.plan!=='Workers Free'||
  evidence.price!==0||evidence.currentPlan!==true||!Array.isArray(evidence.screenshots)||evidence.screenshots.length!==2||
  !Array.isArray(evidence.accountContextScreenshots)||evidence.accountContextScreenshots.length!==2||
  [...evidence.screenshots,...evidence.accountContextScreenshots].some(name=>!/^\d{10}\.jpg$/.test(name)))fail('OWNER_PLAN_EVIDENCE_INVALID');
 return evidence;
}
export function provisioningPlan(report,request,env,now){
 validateProvisionRequest(request,env,now);
 if(report?.readyForProvisioning===true&&report.workersFreePlanVerified===true&&report.blockers?.length===0)return {source:'cloudflare-subscription-api'};
 // Empty successful subscription metadata cannot prove Free. The same-account,
 // short-lived owner dashboard record is a separate, explicitly named proof.
 // It cannot override paid/trial/foreign subscriptions or any failed read.
 if(report?.blockers?.length!==1||report.blockers[0]!=='WORKERS_FREE_PLAN_UNVERIFIED'||report.subscriptionCount!==0||
  report.freePlanHttpStatus!==null||report.freePlanApiErrorCodes?.length!==0||
  !['SUBSCRIPTION_INVENTORY_INCOMPLETE','EXPLICIT_WORKERS_FREE_PLAN_NOT_CONFIRMED'].includes(report.freePlanMetadataError))fail('CLOUDFLARE_PREFLIGHT_BLOCKED');
 return {source:'owner-dashboard-screenshots',apiWorkersFreePlanVerified:false};
}

export async function provisionIsolatedDatabases({env=process.env,request,fetcher=fetch,ciCheck=checkReleaseCi,
 inspect=inspectIsolatedStaging,save,now=()=>Date.now()}={}){
 if(typeof save!=='function')fail('DURABLE_DATABASE_JOURNAL_REQUIRED');
 validateProvisionRequest(request,env,now());
 if(env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_RUN_ATTEMPT!=='1'||
  !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!env.GITHUB_TOKEN||!env.CLOUDFLARE_API_TOKEN||!uuid.test(env.UVENARO_STAGING_DATABASE_ID||''))fail('FIRST_MAIN_PUSH_AND_SECURE_SETTINGS_REQUIRED');
 const state={protocol:'uvenaro-empty-staging-databases-v1',operationId:request.operationId,sha:env.GITHUB_SHA,accountId:request.accountId,
  status:'preflight',created:[],pending:null,remoteChangesPerformed:false,writePermissionsExercised:false,
  workerSourceUploaded:false,sqlUploaded:false,providerRequestsPerformed:false,pilotPreserved:true};
 await save(state);
 async function api(path,method='GET',payload){
  const signal=AbortSignal.timeout(10000);
  try{
   const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+request.accountId+path,{method,redirect:'error',signal,
    headers:{authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,accept:'application/json',...(payload?{'content-type':'application/json'}:{})},
    ...(payload?{body:JSON.stringify(payload)}:{})});
   if(!response.ok||response.redirected)fail('DATABASE_API_UNSUCCESSFUL');
   const body=await boundedJson(response,signal,262144);
   if(body?.success!==true)fail('DATABASE_API_REJECTED');return body;
  }catch{fail(method==='POST'?'DATABASE_CREATE_OUTCOME_UNKNOWN_NO_RETRY':'DATABASE_METADATA_UNAVAILABLE');}
 }
 async function inventory(){
  const dbs=await api('/d1/database?per_page=100&page=1'),workers=await api('/workers/services');
  if(!Array.isArray(dbs.result)||!Number.isInteger(dbs.result_info?.total_count)||dbs.result_info.total_count!==dbs.result.length||!Array.isArray(workers.result))fail('DATABASE_INVENTORY_INCOMPLETE');
  const owned=new Map(state.created.map(d=>[d.uuid,d.name]));
  for(const [id,name] of owned)if(dbs.result.filter(d=>(d.uuid||d.id)===id&&d.name===name).length!==1)fail('CREATED_DATABASE_IDENTITY_MISMATCH');
  const remaining=dbs.result.filter(d=>!owned.has(d.uuid||d.id));
  const plan=inventoryPlan(remaining,workers.result,env.UVENARO_STAGING_DATABASE_ID);
  if(plan.blockers.length||!plan.inventoryVerified)fail('FRESH_DATABASE_INVENTORY_BLOCKED');
  if(dbs.result.length+(3-state.created.length)>10)fail('FREE_DATABASE_CAPACITY_UNAVAILABLE');
  return {count:dbs.result.length,remaining};
 }
 try{
  await ciCheck(env,fetcher);
  const report=await inspect(env,fetcher);state.freePlanEvidence=provisioningPlan(report,request,env,now());
  const baseline=await inventory();state.initialDatabaseCount=baseline.count;
  const initial=JSON.stringify(baseline.remaining.map(d=>[d.uuid||d.id,d.name]).sort());
  await save(state);
  for(const name of stagingNames.databases){
   validateProvisionRequest(request,env,now());await ciCheck(env,fetcher);
   const fresh=await inventory();
   if(JSON.stringify(fresh.remaining.map(d=>[d.uuid||d.id,d.name]).sort())!==initial)fail('DATABASE_INVENTORY_CHANGED');
   state.pending={name,outcome:'unknown-no-retry'};state.status='creating';
   // Durable intent is saved before the single POST. Any interrupted/ambiguous
   // create stops here: no blind retry, name adoption, rollback or pilot write.
   state.remoteChangesPerformed=true;await save(state);
   const created=(await api('/d1/database','POST',{name,primary_location_hint:'apac',read_replication:{mode:'disabled'}})).result;
   if(created?.name!==name||!uuid.test(created?.uuid||'')||created.uuid===env.UVENARO_STAGING_DATABASE_ID||
    baseline.remaining.some(d=>(d.uuid||d.id)===created.uuid)||state.created.some(d=>d.uuid===created.uuid))fail('DATABASE_CREATE_IDENTITY_INVALID_NO_RETRY');
   state.created.push({name,uuid:created.uuid});state.pending=null;state.writePermissionsExercised=true;
   await save(state);
   const verified=(await api('/d1/database/'+created.uuid)).result;
   if(verified?.name!==name||verified?.uuid!==created.uuid)fail('DATABASE_READBACK_IDENTITY_MISMATCH');
  }
  await ciCheck(env,fetcher);await inventory();
  state.status='verified-three-empty-databases';await save(state);return state;
 }catch(error){
  state.status='stopped-review-required';state.error=/^[A-Z_]+$/.test(error.message)?error.message:'PROVISIONING_GATE_FAILED';
  await save(state);throw Error(state.error);
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.slice(2).join(' ')!=='--remote')fail('EXPLICIT_DATABASE_ONLY_REMOTE_ARGUMENT_REQUIRED');
  const request=JSON.parse(await readFile(new URL('../deploy/isolated-staging/provision-request.json',import.meta.url),'utf8'));
  validateProvisionRequest(request,process.env);
  // Wait only for CI before any Cloudflare operation. Exact-main verification
  // is repeated immediately before each write; no failed/missing CI is accepted.
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
   try{await checkReleaseCi();ready=true;break;}catch{}
   if(attempt%10===0)console.log('WAITING_FOR_EXACT_MAIN_CI');
   await new Promise(resolve=>setTimeout(resolve,6000));
  }
  if(!ready)fail('EXACT_MAIN_CI_NOT_READY');
  const directory=resolve('.isolated-staging/provision');await mkdir(directory,{recursive:true});
  const path=resolve(directory,'database-journal.json');
  await writeFile(path,'{}\n',{flag:'wx',mode:0o600});
  const save=async state=>{await writeFile(path+'.tmp',JSON.stringify(state,null,2)+'\n',{mode:0o600});await rename(path+'.tmp',path);};
  const result=await provisionIsolatedDatabases({request,save});
  // Source remains local to the GitHub runner; no schema or Worker is uploaded
  // to Cloudflare during this database-only operation.
  const {buildIsolatedStaging}=await import('./prepare-isolated-staging.mjs');
  const ids=result.created.map(d=>d.uuid);
  await buildIsolatedStaging(resolve('.isolated-staging/bound-workers'),{env:{...process.env,
   UVENARO_CHAT_STAGING_DATABASE_ID:ids[0],UVENARO_GATEWAY_STAGING_DATABASE_ID:ids[1],UVENARO_ADAPTER_STAGING_DATABASE_ID:ids[2]}});
  console.log(JSON.stringify(result));
 }catch(error){console.error(/^[A-Z_]+$/.test(error.message)?error.message:'DATABASE_ONLY_PREPARATION_FAILED');process.exitCode=1;}
}
