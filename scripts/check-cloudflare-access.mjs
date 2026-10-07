import {pathToFileURL} from 'node:url';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
// Presence/authorization evidence only. Never print provider bodies or secrets.
export async function inspectCloudflareAccess(env=process.env,fetcher=fetch){
 const required=['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','UVENARO_STAGING_DATABASE_ID'];
 const missing=required.filter(name=>!env[name]);
 const report={credentialContext:'github-environment:uvenaro-account-staging',configured:missing.length===0,missing,
  workersRead:false,existingStagingDatabaseRead:false,writePermissionsVerified:false,remoteChangesPerformed:false};
 if(missing.length)return report;
 if(!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID)||!uuid.test(env.UVENARO_STAGING_DATABASE_ID))return {...report,error:'INVALID_NON_SECRET_IDENTIFIERS'};
 async function read(path){
  const signal=AbortSignal.timeout(15000);
  let response;
  try{response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID+path,{
   headers:{authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,accept:'application/json'},redirect:'error',signal});
  }catch{return {error:'ACCESS_CHECK_NETWORK_OR_REDIRECT_FAILURE'};}
  if(!response.ok)return {error:[401,403].includes(response.status)?'ACCESS_CHECK_AUTH_OR_PERMISSION_DENIED':'ACCESS_CHECK_SERVICE_FAILURE'};
  const reader=response.body?.getReader();if(!reader)return {error:'ACCESS_CHECK_INVALID_RESPONSE'};
  const chunks=[];let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{while(true){if(signal.aborted)return {error:'ACCESS_CHECK_TIMEOUT'};const {done,value}=await reader.read();if(signal.aborted)return {error:'ACCESS_CHECK_TIMEOUT'};if(done)break;size+=value.length;if(size>65536){await reader.cancel();return {error:'ACCESS_CHECK_RESPONSE_LIMIT'};}chunks.push(value);}}
  catch{return {error:'ACCESS_CHECK_INVALID_RESPONSE'};}finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
  try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));return result.success===true?{result:result.result}:{error:'ACCESS_CHECK_API_REJECTED'};}
  catch{return {error:'ACCESS_CHECK_INVALID_RESPONSE'};}
 }
 const workers=await read('/workers/services');report.workersRead=Array.isArray(workers.result);
 const database=await read('/d1/database/'+env.UVENARO_STAGING_DATABASE_ID);
 report.existingStagingDatabaseRead=database.result?.name==='uvenaro-account-staging'&&(database.result.uuid||database.result.id)===env.UVENARO_STAGING_DATABASE_ID;
 report.errors=[workers.error,database.error,...(!report.existingStagingDatabaseRead&&!database.error?['STAGING_DATABASE_IDENTITY_MISMATCH']:[])].filter(Boolean);
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const report=await inspectCloudflareAccess();console.log(JSON.stringify(report));
  if(!report.configured||!report.workersRead||!report.existingStagingDatabaseRead)process.exitCode=1;
 }catch{console.error('ACCESS_CHECK_UNAVAILABLE');process.exitCode=1;}
}
