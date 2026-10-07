import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {buildIsolatedStaging} from './prepare-isolated-staging.mjs';
import {inspectIsolatedStaging,stagingNames} from './inspect-isolated-staging.mjs';
import {provisioningPlan} from './provision-isolated-databases.mjs';
import {checkReleaseCi} from './check-release-ci.mjs';
import {boundedJson} from '../backend/metered-gateway.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),probeName='uvenaro-isolated-staging-probe';
const fail=code=>{throw Error(code);};
const schemaQuery="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' AND name!='_cf_KV' ORDER BY type,name";
function normalizedSql(sql){
 const tokens=[];let i=0;
 while(i<sql.length){
  if(/\s/.test(sql[i])){i++;continue;}
  if(sql.slice(i,i+2)==='--'){while(i<sql.length&&sql[i]!=='\n')i++;continue;}
  if(sql.slice(i,i+2)==='/*'){const end=sql.indexOf('*/',i+2);if(end<0)fail('SCHEMA_SQL_COMMENT_INVALID');i=end+2;continue;}
  const start=i,quote=sql[i];
  if(["'",'"','`','['].includes(quote)){
   const end=quote==='['?']':quote;i++;let closed=false;
   while(i<sql.length){if(sql[i++]===end){if(quote!=='['&&sql[i]===end){i++;continue;}closed=true;break;}}
   if(!closed)fail('SCHEMA_SQL_QUOTE_INVALID');tokens.push(sql.slice(start,i));continue;
  }
  if(/[A-Za-z0-9_$]/.test(sql[i])){while(i<sql.length&&/[A-Za-z0-9_$]/.test(sql[i]))i++;tokens.push(sql.slice(start,i).toLowerCase());}
  else tokens.push(sql[i++]);
 }
 return tokens.join(' ');
}
export function schemaFingerprint(objects){
 if(!Array.isArray(objects)||objects.some(o=>!['table','index','trigger'].includes(o.type)||typeof o.name!=='string'||typeof o.tbl_name!=='string'||typeof o.sql!=='string'))fail('SCHEMA_METADATA_INVALID');
 const normalized=objects.map(o=>[o.type,o.name,o.tbl_name,normalizedSql(o.sql)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
export function validateUpload(request,record,env,now=Date.now()){
 if(request?.protocol!=='uvenaro-safe-off-staging-upload-v1'||request.sourceUploadAuthorized!==true||request.providerCallsPermitted!==false||
  request.allowedAction!=='isolated-schemas-private-workers-and-temporary-authenticated-probe'||request.repository!=='Utkarsh-verma-sushama/toonverse-ai'||
  request.repository!==env.GITHUB_REPOSITORY||request.accountId!==env.CLOUDFLARE_ACCOUNT_ID||record.accountId!==request.accountId||
  env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_RUN_ATTEMPT!=='1'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||
  !env.GITHUB_TOKEN||!env.CLOUDFLARE_API_TOKEN||!/^[a-z0-9-]{10,100}$/.test(request.operationId||''))fail('SAFE_OFF_UPLOAD_AUTHORIZATION_INVALID');
 const approved=Date.parse(request.approvedAt),expires=Date.parse(request.expiresAt);
 if(!Number.isFinite(approved)||!Number.isFinite(expires)||approved>now||now>=expires||expires-approved>6*3600000)fail('SAFE_OFF_UPLOAD_AUTHORIZATION_EXPIRED');
 const ids=record.databases?.map(d=>d.uuid)||[];
 if(record.protocol!=='uvenaro-verified-isolated-databases-v1'||ids.length!==3||new Set(ids).size!==3||ids.includes(env.UVENARO_STAGING_DATABASE_ID)||
  ids.some(id=>!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))||
  record.databases.some((d,i)=>d.name!==stagingNames.databases[i]||d.role!==['billing','gateway-receipts','adapter-evidence'][i]))fail('OWNED_DATABASE_RECORD_INVALID');
 return ids;
}
export function verifiedSchemaRows(value){
 if(!Array.isArray(value)||value.length!==1||value[0]?.success!==true||!Array.isArray(value[0].results))fail('REMOTE_SQL_RESPONSE_INVALID');return value[0].results;
}
export function validatePrivateSettings(settings,subdomain,config,secretNames){
 if(subdomain?.enabled!==false||subdomain.previews_enabled!==false||settings?.observability?.enabled===true)fail('PRIVATE_WORKER_ENDPOINT_UNVERIFIED');
 const bindings=settings.bindings;if(!Array.isArray(bindings))fail('WORKER_BINDINGS_UNVERIFIED');
 for(const db of config.d1_databases)if(!bindings.some(b=>b.name===db.binding&&b.type==='d1'&&(b.id||b.database_id)===db.database_id))fail('WORKER_DATABASE_BINDING_MISMATCH');
 for(const [name,text] of Object.entries(config.vars))if(!bindings.some(b=>b.name===name&&b.type==='plain_text'&&b.text===text))fail('WORKER_SAFE_OFF_VARIABLE_MISMATCH');
 for(const name of secretNames)if(!bindings.some(b=>b.name===name&&b.type==='secret_text'))fail('WORKER_SECRET_SCOPE_MISSING');
 if(bindings.some(b=>b.name==='GEMINI_API_KEY'))fail('PROVIDER_KEY_NOT_ALLOWED');
 for(const service of config.services||[])if(!bindings.some(b=>b.name===service.binding&&b.type==='service'&&b.service===service.service))fail('PRIVATE_SERVICE_BINDING_MISMATCH');
}

export function validateResume(journal,request,manifestHash){
 const proof=request.resume;
 if(!proof||proof.sourceCommit!==journal?.sha||proof.operationId!==journal.operationId||proof.journalSha256!==createHash('sha256').update(JSON.stringify(journal)).digest('hex')||
  journal.status!=='stopped-review-required'||journal.pending!==null||journal.error!=='REMOTE_PRIVATE_SMOKE_FAILED'||journal.providerRequestsPerformed!==false||
  journal.pilotPreserved!==true||journal.manifestSha256!==manifestHash||!['worker-fixture:adapter','worker-fixture:gateway','temporary-probe','temporary-probe-scopes'].every(step=>journal.steps?.includes(step)))fail('RESUME_OWNERSHIP_EVIDENCE_INVALID');
 return true;
}
export async function writeScopedSecret(api,name,text){
 if(!/^[A-Z_]+$/.test(name)||!/^[A-Za-z0-9_-]{32,256}$/.test(text))fail('SECRET_SCOPE_INPUT_INVALID');
 const result=await api({name,text,type:'secret_text'});
 if(result?.name!==name||result.type!=='secret_text')fail('SECRET_WRITE_ACKNOWLEDGEMENT_MISSING');
}

export async function deployIsolatedStaging(){
 const env=process.env,request=JSON.parse(await readFile(resolve(root,'deploy/isolated-staging/upload-request.json'),'utf8')),
  record=JSON.parse(await readFile(resolve(root,'deploy/isolated-staging/verified-databases.json'),'utf8')),
  planRequest=JSON.parse(await readFile(resolve(root,'deploy/isolated-staging/provision-request.json'),'utf8'));
 const ids=validateUpload(request,record,env),directory=resolve(root,'.isolated-staging/upload'),journalPath=resolve(directory,'upload-journal.json');
 await mkdir(directory,{recursive:true,mode:0o700});await writeFile(journalPath,'{}\n',{flag:'wx',mode:0o600});
 const state={protocol:request.protocol,operationId:request.operationId,sha:env.GITHUB_SHA,status:'preflight',pending:null,steps:[],
  providerRequestsPerformed:false,pilotPreserved:true,probeRemoved:false,workersRestoredToBlankModel:false};
 async function save(){await writeFile(journalPath+'.tmp',JSON.stringify(state,null,2)+'\n',{mode:0o600});await rename(journalPath+'.tmp',journalPath);}
 async function mutate(label,operation){await checkReleaseCi();validateUpload(request,record,env);state.pending=label;await save();const result=await operation();state.steps.push(label);state.pending=null;await save();return result;}
 async function api(path,method='GET',payload){
  const signal=AbortSignal.timeout(15000);let response;
  try{response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+request.accountId+path,{method,redirect:'error',signal,headers:{authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,...(payload?{'content-type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});}catch{fail('DEPLOYMENT_METADATA_UNAVAILABLE');}
  if(!response.ok)fail(method==='GET'?'DEPLOYMENT_METADATA_DENIED':'DEPLOYMENT_WRITE_UNCONFIRMED');if(method==='DELETE'&&response.status===204)return {success:true};const body=await boundedJson(response,signal,1048576);if(body.success!==true)fail('DEPLOYMENT_METADATA_REJECTED');return body;
 }
 function wrangler(args,config,input){
  const out=spawnSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--config',config],{
   cwd:root,env:{...env,CI:'true',WRANGLER_SEND_METRICS:'false'},encoding:'utf8',input,maxBuffer:4*1024*1024,timeout:180000});
  if(out.error||out.status!==0){
   const raw=String(out.stdout||'')+'\n'+String(out.stderr||'');
   const codes=[...raw.matchAll(/(?:code:|code\s*=)\s*(\d{3,6})/g)].map(m=>Number(m[1])).slice(0,8);
   const sqlClass=['already exists','duplicate column','syntax error','not authorized','no such table','no such column'].find(s=>raw.toLowerCase().includes(s))||null;
   console.error(JSON.stringify({safeWranglerDiagnostic:{command:args.slice(0,2),exitStatus:out.status,codes,sqlClass}}));
   fail('WRANGLER_OPERATION_UNCONFIRMED_NO_RETRY');
  }return out.stdout;
 }
 const configs={};let probeOwned=false;
 const resume=request.resume?JSON.parse(await readFile(resolve(root,'deploy/isolated-staging/upload-resume-journal.json'),'utf8')):null;
 const deleteProbe=()=>api('/workers/scripts/'+probeName+'?force=true','DELETE');
 async function secretsFor(name,script,scopes){
  for(const [key,value] of Object.entries(scopes))await mutate('secret:'+name+':'+key,()=>writeScopedSecret(async payload=>(await api('/workers/scripts/'+script+'/secrets','PUT',payload)).result,key,value));
  const bindings=(await api('/workers/scripts/'+script+'/settings')).result?.bindings;
  if(!Array.isArray(bindings)||!Object.keys(scopes).every(key=>bindings.some(b=>b.name===key&&b.type==='secret_text')))fail('LIVE_SECRET_SCOPES_UNVERIFIED');
 }
 try{
  await checkReleaseCi();
  for(const db of record.databases){const metadata=(await api('/d1/database/'+db.uuid)).result;if(metadata?.uuid!==db.uuid||metadata.name!==db.name)fail('LIVE_DATABASE_OWNERSHIP_MISMATCH');}
  const report=await inspectIsolatedStaging();
  const expected=stagingNames.databases;
  if(report.inventory?.databaseCount!==4||report.inventory.databaseCollisions?.length!==3||
   !expected.every(n=>report.inventory.databaseCollisions.includes(n))||(!resume&&report.inventory.workerCollisions?.length)||
   report.inventory.blockers?.some(b=>b!=='EXISTING_TARGET_RESOURCE_REQUIRES_OWNERSHIP_REVIEW'))fail('OWNED_ISOLATED_INVENTORY_MISMATCH');
  report.blockers=report.blockers.filter(b=>b!=='EXISTING_TARGET_RESOURCE_REQUIRES_OWNERSHIP_REVIEW');report.readyForProvisioning=report.blockers.length===0;
  state.freePlanEvidence=provisioningPlan(report,planRequest,env);
  const services=(await api('/workers/services')).result;
  if(!Array.isArray(services)||(!resume&&services.some(s=>[...stagingNames.workers,probeName].includes(s.id||s.name))))fail('WORKER_NAME_ALREADY_EXISTS');
  const prepared=await buildIsolatedStaging(resolve(directory,'package'),{env:{...env,UVENARO_CHAT_STAGING_DATABASE_ID:ids[0],UVENARO_GATEWAY_STAGING_DATABASE_ID:ids[1],UVENARO_ADAPTER_STAGING_DATABASE_ID:ids[2]}});
  state.manifestSha256=createHash('sha256').update(await readFile(resolve(prepared.directory,'manifest.json'))).digest('hex');await save();
  for(const name of ['adapter','gateway'])configs[name]=resolve(prepared.directory,name,'wrangler.json');
  if(resume){
   validateResume(resume,request,state.manifestSha256);state.resumedFrom=request.resume.sourceCommit;
   for(const name of ['adapter','gateway']){
    const config=JSON.parse(await readFile(configs[name],'utf8'));if(name==='adapter')config.vars.GEMINI_MODEL='gemini-3.8-flash';else{config.vars.GATEWAY_PROVIDER='google-gemini';config.vars.GATEWAY_MODEL='gemini-3.8-flash';}
    const settings=(await api('/workers/scripts/'+config.name+'/settings')).result,endpoint=(await api('/workers/scripts/'+config.name+'/subdomain')).result;
    validatePrivateSettings(settings,endpoint,config,[]);
    state[name+'PriorSecretScopes']=(settings.bindings||[]).filter(b=>b.type==='secret_text').map(b=>b.name);
   }
   if(services.some(s=>(s.id||s.name)===probeName)){
    const settings=(await api('/workers/scripts/'+probeName+'/settings')).result;
    if(!settings?.bindings?.some(b=>b.name==='FIXTURE_READ_ID'&&b.text==='uvenaro_fixture_read_'+request.resume.workflowRunId)||settings.bindings.some(b=>b.name==='GEMINI_API_KEY'))fail('PRIOR_PROBE_OWNERSHIP_MISMATCH');
    await mutate('remove-owned-prior-probe',deleteProbe);
    if((await api('/workers/services')).result.some(s=>(s.id||s.name)===probeName))fail('PRIOR_PROBE_REMOVAL_UNVERIFIED');
   }
  }
  const query=(binding,config,sql)=>{let result;try{result=JSON.parse(wrangler(['d1','execute',binding,'--remote','--command',sql,'--json'],config));}catch{fail('REMOTE_SQL_CHECK_UNAVAILABLE');}return verifiedSchemaRows(result);};
  for(const [role,binding,config] of [['billing','DB',configs.adapter],['gateway','GATEWAY_DB',configs.gateway],['adapter','ADAPTER_DB',configs.adapter]]){
   if(!resume&&query(binding,config,schemaQuery).length!==0)fail('ISOLATED_SCHEMA_NOT_EMPTY_REQUIRES_REVIEW');
   const local=new DatabaseSync(':memory:');
   try{
    for(const file of Object.keys(prepared.manifest.files).filter(f=>f.startsWith(role+'/')&&f.endsWith('.sql')).sort()){
     const path=resolve(prepared.directory,file),source=await readFile(path,'utf8');local.exec(source);
     if(resume){if(!resume.steps.includes('schema:'+file))fail('RESUME_SCHEMA_CHAIN_INCOMPLETE');continue;}
     await mutate('schema:'+file,async()=>wrangler(['d1','execute',binding,'--remote','--file',path],config));
     if(schemaFingerprint(query(binding,config,schemaQuery))!==schemaFingerprint(local.prepare(schemaQuery).all()))fail('REMOTE_SCHEMA_FINGERPRINT_MISMATCH');
    }
    if(resume){if(schemaFingerprint(query(binding,config,schemaQuery))!==schemaFingerprint(local.prepare(schemaQuery).all()))fail('RESUME_SCHEMA_DRIFT');state.steps.push('schema-verified:'+role);await save();}
   }finally{local.close();}
  }
  const secrets=Array.from({length:5},()=>randomBytes(32).toString('base64url'));
  if(new Set(secrets).size!==5)fail('SECRET_ENTROPY_COLLISION');
  for(const secret of secrets)process.stdout.write('::add-mask::'+secret+'\n');
  const [gd,gr,ad,ar,pk]=secrets;
  const scopes={adapter:{ADAPTER_DISPATCH_KEY:ad,ADAPTER_RECEIPT_KEY:ar},gateway:{GATEWAY_DISPATCH_KEY:gd,GATEWAY_RECEIPT_KEY:gr,GATEWAY_ADAPTER_DISPATCH_KEY:ad,GATEWAY_ADAPTER_RECEIPT_KEY:ar}};
  const original={};const fixtureModel='gemini-3.8-flash';
  for(const name of ['adapter','gateway']){
   original[name]=JSON.parse(await readFile(configs[name],'utf8'));
   const config=structuredClone(original[name]);if(name==='adapter')config.vars.GEMINI_MODEL=fixtureModel;else{config.vars.GATEWAY_PROVIDER='google-gemini';config.vars.GATEWAY_MODEL=fixtureModel;}
   await writeFile(configs[name],JSON.stringify(config,null,2)+'\n');
   await mutate('worker-fixture:'+name,async()=>wrangler(['deploy'],configs[name]));
   await secretsFor(name,config.name,scopes[name]);
  }
  const readId='uvenaro_fixture_read_'+env.GITHUB_RUN_ID,recoveryId='uvenaro_fixture_recovery_'+env.GITHUB_RUN_ID;
  if(!/^[A-Za-z0-9_]{1,100}$/.test(readId+'' )||!/^[A-Za-z0-9_]{1,100}$/.test(recoveryId))fail('FIXTURE_ID_INVALID');
  const recordId='gemini_'+'c'.repeat(64),q=value=>"'"+value.replaceAll("'","''")+"'";
  for(const [binding,config] of [['GATEWAY_DB',configs.gateway],['ADAPTER_DB',configs.adapter]]){
   let sql='';
   for(const id of [readId,recoveryId]){
    sql+="INSERT INTO gateway_receipts(request_id,request_hash,provider,model,input_limit,output_limit,status,created_at) VALUES("+q(id)+",'"+'a'.repeat(64)+"','google-gemini',"+q(fixtureModel)+",100,50,'dispatching','uvenaro-fixture');\n";
    if(binding==='ADAPTER_DB')sql+="INSERT INTO adapter_vendor_evidence VALUES("+q(id)+','+q('fixture-vendor-'+id)+','+q(id===readId?recordId:'gemini_'+'d'.repeat(64))+",10,8,'uvenaro-fixture');\n";
    sql+="UPDATE gateway_receipts SET status='unknown' WHERE request_id="+q(id)+";\n";
   }
   if(binding==='GATEWAY_DB')sql+="UPDATE gateway_receipts SET status='completed',record_id="+q(recordId)+",billable=1,input_tokens=10,output_tokens=8,finalized_at='uvenaro-fixture' WHERE request_id="+q(readId)+";";
   const file=resolve(directory,binding+'-fixture.sql');await writeFile(file,sql);await mutate('fixture-evidence:'+binding,async()=>wrangler(['d1','execute',binding,'--remote','--file',file],config));
  }
  const probeDir=resolve(directory,'probe');await mkdir(probeDir,{recursive:true});
  const compiled=await build({entryPoints:[resolve(root,'backend/isolated-staging-probe.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});await writeFile(resolve(probeDir,'worker.mjs'),compiled.outputFiles[0].contents);
  const probe={name:probeName,main:'worker.mjs',compatibility_date:'2026-08-06',workers_dev:true,preview_urls:false,observability:{enabled:false},
   vars:{...JSON.parse(await readFile(configs.gateway,'utf8')).vars,FIXTURE_READ_ID:readId,FIXTURE_RECOVERY_ID:recoveryId},
   d1_databases:original.adapter.d1_databases,services:[{binding:'TARGET_GATEWAY',service:stagingNames.workers[0]},{binding:'TARGET_ADAPTER',service:stagingNames.workers[1]}]};
  configs.probe=resolve(probeDir,'wrangler.json');await writeFile(configs.probe,JSON.stringify(probe,null,2));
  await mutate('temporary-probe',async()=>wrangler(['deploy'],configs.probe));probeOwned=true;
  await secretsFor('probe',probeName,{...scopes.gateway,...scopes.adapter,PROBE_KEY:pk});
  const subdomain=(await api('/workers/subdomain')).result?.subdomain;if(!/^[a-z0-9-]{1,63}$/.test(subdomain||''))fail('WORKERS_SUBDOMAIN_UNVERIFIED');
  const probeOrigin='https://'+probeName+'.'+subdomain+'.workers.dev';
  async function readProbe(path,key){
   let last;
   for(let attempt=0;attempt<5;attempt++){
    try{last=await fetch(probeOrigin+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(45000),headers:key?{authorization:'Bearer '+key}:{}});if(last.status===200||(!key&&last.status===401))return last;}catch{}
    if(attempt<4)await new Promise(resolve=>setTimeout(resolve,3000));
   }
   if(!last)fail('REMOTE_PROBE_UNAVAILABLE');return last;
  }
  async function smoke(path){
   const response=await readProbe(path,pk),result=await boundedJson(response,AbortSignal.timeout(5000),8192);
   if(!response.ok||result.ok!==true||result.providerRequestsPerformed!==false){
    console.error(JSON.stringify({privateSmokeDiagnostic:{phase:path,status:response.status,checksPassed:Number.isInteger(result.checksPassed)?result.checksPassed:null,reason:/^[A-Z_]+$/.test(result.reason||'')?result.reason:null}}));fail('REMOTE_PRIVATE_SMOKE_FAILED');
   }state.steps.push('acceptance:'+path+':'+result.checks);await save();
  }
  const unauth=await readProbe('/smoke');if(unauth.status!==401)fail('PROBE_AUTH_BOUNDARY_FAILED');
  await smoke('/smoke');
  // Redeployment is a runtime restart/version replacement, not a database reset.
  for(const name of ['adapter','gateway'])await mutate('restart-fixture:'+name,async()=>wrangler(['deploy'],configs[name]));
  await smoke('/smoke');
  for(const name of ['adapter','gateway']){
   await writeFile(configs[name],JSON.stringify(original[name],null,2)+'\n');await mutate('restore-private-safe-off:'+name,async()=>wrangler(['deploy'],configs[name]));
   const script=original[name].name,settings=(await api('/workers/scripts/'+script+'/settings')).result,endpoint=(await api('/workers/scripts/'+script+'/subdomain')).result;
   validatePrivateSettings(settings,endpoint,original[name],Object.keys(scopes[name]));
   const deployments=(await api('/workers/scripts/'+script+'/deployments')).result;
   const records=deployments?.deployments;
   if(!Array.isArray(records)||!records.length)fail('WORKER_DEPLOYMENT_IDENTITY_UNVERIFIED');
   state[name+'Deployment']=records.slice(0,1).map(d=>({id:d.id,versions:(d.versions||[]).map(v=>({version_id:v.version_id,percentage:v.percentage}))}));
  }
  state.workersRestoredToBlankModel=true;await smoke('/final');
  await mutate('remove-temporary-probe',deleteProbe);probeOwned=false;
  const remaining=(await api('/workers/services')).result;if(!Array.isArray(remaining)||remaining.some(w=>(w.id||w.name)===probeName))fail('TEMPORARY_PROBE_REMOVAL_UNVERIFIED');
  state.probeRemoved=true;state.status='private-safe-off-staging-accepted';await save();console.log(JSON.stringify(state));
 }catch(error){state.status='stopped-review-required';state.error=/^[A-Z_]+$/.test(error.message)?error.message:'ISOLATED_UPLOAD_UNCONFIRMED';await save();throw Error(state.error);}
 finally{
  // Delete only the authenticated probe whose successful creation this run owns.
  if(probeOwned)try{await checkReleaseCi();validateUpload(request,record,env);await deleteProbe();state.probeRemoved=!(await api('/workers/services')).result.some(s=>(s.id||s.name)===probeName);await save();}catch{}
  // No secret files are written or uploaded as artifacts; Wrangler diagnostics
  // are suppressed and operation output/journal contains no credential values.
  await rm(resolve(directory,'probe/worker.mjs'),{force:true});
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.slice(2).join(' ')!=='--remote')fail('EXPLICIT_APPROVED_UPLOAD_ARGUMENT_REQUIRED');
  let ready=false;for(let i=0;i<100;i++){try{await checkReleaseCi();ready=true;break;}catch{}if(i%10===0)console.log('WAITING_FOR_EXACT_MAIN_CI');await new Promise(resolve=>setTimeout(resolve,6000));}
  if(!ready)fail('EXACT_MAIN_CI_NOT_READY');await deployIsolatedStaging();
 }catch(error){console.error(/^[A-Z_]+$/.test(error.message)?error.message:'ISOLATED_UPLOAD_UNCONFIRMED');process.exitCode=1;}
}
