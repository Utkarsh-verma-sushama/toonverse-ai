import {pathToFileURL} from 'node:url';
import {boundedJson} from '../backend/metered-gateway.mjs';
export const stagingNames=Object.freeze({databases:['uvenaro-chat-staging','uvenaro-gateway-receipts-staging','uvenaro-adapter-evidence-staging'],workers:['uvenaro-metered-gateway-staging','uvenaro-bounded-provider-adapter-staging']});
// A declared token scope is not an exercised write. Denied metadata is unknown,
// never interpreted as either write permission or proof that access is absent.
export function declaredScopes(token,account){
 const result={inspectable:false,workersCreateDeclared:false,d1WriteDeclared:false};
 if(!Array.isArray(token?.policies)||!token.policies.length)return result;
 result.inspectable=true;
 if(token.policies.some(p=>p.effect!=='allow'))return result;
 const key='com.cloudflare.api.account.'+account;
 for(const p of token.policies){
  if(p.resources?.[key]!=='*'&&p.resources?.['com.cloudflare.api.account.*']!=='*')continue;
  const names=new Set((p.permission_groups||[]).map(g=>g.name));
  if(names.has('Workers Scripts Write'))result.workersCreateDeclared=true;
  if(names.has('D1 Write')||names.has('D1 Edit'))result.d1WriteDeclared=true;
 }
 return result;
}
export function inventoryPlan(databases,workers,pilotId){
 if(!Array.isArray(databases)||!Array.isArray(workers))return {inventoryVerified:false,blockers:['INVENTORY_UNAVAILABLE']};
 const ids=databases.map(d=>d.uuid||d.id);
 if(ids.some(id=>!id)||new Set(ids).size!==ids.length)return {inventoryVerified:false,blockers:['DATABASE_INVENTORY_INVALID']};
 const blockers=[];
 if(!databases.some(d=>(d.uuid||d.id)===pilotId&&d.name==='uvenaro-account-staging'))blockers.push('PILOT_IDENTITY_MISMATCH');
 const databaseCollisions=stagingNames.databases.filter(name=>databases.some(d=>d.name===name));
 const workerCollisions=stagingNames.workers.filter(name=>workers.some(w=>w.id===name||w.name===name));
 if(databaseCollisions.length||workerCollisions.length)blockers.push('EXISTING_TARGET_RESOURCE_REQUIRES_OWNERSHIP_REVIEW');
 if(databases.length+stagingNames.databases.length>10)blockers.push('FREE_DATABASE_CAPACITY_UNAVAILABLE');
 return {inventoryVerified:true,pilotPreserved:true,databaseCount:databases.length,newDatabaseCount:3,databaseCollisions,workerCollisions,blockers};
}
export async function inspectIsolatedStaging(env=process.env,fetcher=fetch){
 const account=env.CLOUDFLARE_ACCOUNT_ID,pilot=env.UVENARO_STAGING_DATABASE_ID;
 const report={phase:'isolated-staging-preflight',remoteChangesPerformed:false,writePermissionsExercised:false,providerRequestsPerformed:false,readyForProvisioning:false,blockers:[]};
 if(!/^[a-f0-9]{32}$/.test(account||'')||!env.CLOUDFLARE_API_TOKEN||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(pilot||''))return {...report,blockers:['SECURE_SETTINGS_MISSING_OR_INVALID']};
 const prefix='/accounts/'+account;
 async function get(path){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await new Promise((resolve,reject)=>{
    const stop=()=>reject(Error('timeout'));controller.signal.addEventListener('abort',stop,{once:true});
    Promise.resolve().then(()=>fetcher('https://api.cloudflare.com/client/v4'+path,{method:'GET',redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,accept:'application/json'}})).then(r=>{
     controller.signal.removeEventListener('abort',stop);if(controller.signal.aborted){void r.body?.cancel().catch(()=>{});stop();}else resolve(r);
    },error=>{controller.signal.removeEventListener('abort',stop);reject(error);});
   });
   if(!response.ok){void response.body?.cancel().catch(()=>{});return {error:[401,403].includes(response.status)?'METADATA_ACCESS_DENIED':'METADATA_CHECK_FAILED'};}
   const body=await boundedJson(response,controller.signal,262144);
   return body?.success===true?body:{error:'METADATA_API_REJECTED'};
  }catch{return {error:'METADATA_CHECK_UNAVAILABLE'};}finally{clearTimeout(timer);}
 }
 // Inventory must be complete; a truncated page cannot justify free capacity.
 const databases=await get(prefix+'/d1/database?per_page=100&page=1'),workers=await get(prefix+'/workers/services');
 const complete=Array.isArray(databases.result)&&Number.isInteger(databases.result_info?.total_count)&&databases.result_info.total_count===databases.result.length;
 const inventory=inventoryPlan(complete?databases.result:null,workers.result,pilot);report.inventory=inventory;report.blockers.push(...inventory.blockers);
 let verified=await get(prefix+'/tokens/verify'),tokenPath=prefix+'/tokens/';
 if(verified.result?.status!=='active'||!/^[a-f0-9]{32}$/.test(verified.result?.id||'')){verified=await get('/user/tokens/verify');tokenPath='/user/tokens/';}
 const active=verified.result?.status==='active'&&/^[a-f0-9]{32}$/.test(verified.result?.id||'');
 report.tokenActive=active;
 const details=active?await get(tokenPath+verified.result.id):{};
 report.scopes=declaredScopes(details.result,account);
 if(!active)report.blockers.push('TOKEN_STATUS_UNVERIFIED');
 if(!report.scopes.inspectable)report.blockers.push('TOKEN_SCOPE_METADATA_UNAVAILABLE');
 else if(!report.scopes.workersCreateDeclared||!report.scopes.d1WriteDeclared)report.blockers.push('REQUIRED_ACCOUNT_WRITE_SCOPES_UNVERIFIED');
 const subscriptions=await get(prefix+'/subscriptions?per_page=100&page=1');
 const full=Array.isArray(subscriptions.result)&&Number.isInteger(subscriptions.result_info?.total_count)&&subscriptions.result_info.total_count===subscriptions.result.length;
 // No inference from an empty list, account usage model, trial or unrelated free SKU.
 const relevant=full?subscriptions.result.filter(s=>/workers/i.test(s.rate_plan?.public_name||'')):[];
 report.workersFreePlanVerified=relevant.length>0&&relevant.every(s=>s.rate_plan?.id==='free'&&s.price===0&&!s.rate_plan.externally_managed&&!s.rate_plan.is_contract);
 if(!report.workersFreePlanVerified)report.blockers.push('WORKERS_FREE_PLAN_UNVERIFIED');
 report.readyForProvisioning=report.blockers.length===0;
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await inspectIsolatedStaging()));}catch{console.error('ISOLATED_STAGING_INSPECTION_UNAVAILABLE');process.exitCode=1;}
}
