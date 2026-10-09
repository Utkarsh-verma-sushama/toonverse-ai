import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

export const GEMINI_PROJECT_PROBE_PROTOCOL='uvenaro-gemini-project-probe-v1';
const DEFAULT_MODEL='gemini-3.8-flash';
const BASE_URL='https://generativelanguage.googleapis.com/v1beta';

function safeModel(value){
 return typeof value==='string'&&/^gemini-[a-z0-9.-]{1,80}$/.test(value);
}
function safeKey(value){
 return typeof value==='string'&&value.length>=20&&value.length<=256&&!/[\r\n]/.test(value);
}
async function readJson(response){
 const text=await response.text();
 if(text.length>262144)throw new Error('PROBE_RESPONSE_TOO_LARGE');
 try{return JSON.parse(text);}catch{throw new Error('PROBE_RESPONSE_NOT_JSON');}
}
function errorCode(error){return error?.message==='PROBE_RESPONSE_TOO_LARGE'||error?.message==='PROBE_RESPONSE_NOT_JSON'?error.message:'PROBE_NETWORK_ERROR';}

export async function runGeminiProjectProbe({apiKey,model=DEFAULT_MODEL,fetcher=fetch,baseUrl=BASE_URL,projectId=null,projectNumber=null,tier=null,billingAccountAttached=null,bindingReadback=false}={}){
 const result={
  protocol:GEMINI_PROJECT_PROBE_PROTOCOL,
  provider:'google-gemini',
  model,
  generationCalled:false,
  providerRequestsPermitted:false,
  verified:false,
  modelList:{status:null,modelFound:false,supportedMethods:[]},
  countTokens:{status:null,totalTokens:null},
  errors:[],
  credential:{name:'GEMINI_API_KEY',keyPresent:false,digest:null,acknowledgements:{declared:false,liveBindingReadback:Boolean(bindingReadback),boundedPropagationRetries:false}},
  project:{bindingVerified:Boolean(bindingReadback),id:projectId,number:projectNumber,tier,billingAccountAttached},
  endpoint:{baseUrl,endpointVerified:baseUrl===BASE_URL,redirectsBlocked:true,tlsVerified:baseUrl.startsWith('https://')},
  usage:{countTokensNonbillableVerified:false,authoritativeReceiptGetVerified:false,billable:false,totalTokens:null},
  privacy:{store:false,background:false,promptsPersisted:false,answersPersisted:false,retentionDays:0},
  funding:{ownerSpendCapMicrousd:0,paidRequestsAllowed:false,autoTopUp:false},
  runtime:{generationEnabled:false,providerCallsPermitted:false,activationAuthorized:false}
 };
 if(!safeKey(apiKey)){result.errors.push('PROBE_API_KEY_INVALID');return result;}
 result.credential.keyPresent=true;
 result.credential.digest=credentialDigest(apiKey);
 result.credential.acknowledgements.declared=true;
 if(!safeModel(model)){result.errors.push('PROBE_MODEL_INVALID');return result;}
 const headers={'x-goog-api-key':apiKey,'accept':'application/json','content-type':'application/json'};
 const request=async(url,options)=>{
  let response;
  try{response=await fetcher(url,{...options,redirect:'error',headers});}
  catch(error){throw new Error(errorCode(error));}
  let body;
  try{body=await readJson(response);}catch(error){throw error;}
  return {response,body};
 };
 try{
  const listed=await request(baseUrl+'/models',{method:'GET'});
  result.modelList.status=listed.response.status;
  if(!listed.response.ok){result.errors.push('PROBE_MODELS_LIST_HTTP_ERROR');return result;}
  const models=Array.isArray(listed.body.models)?listed.body.models:[];
  const found=models.find(item=>item?.name==='models/'+model||item?.name===model);
  result.modelList.modelFound=Boolean(found);
  result.modelList.supportedMethods=Array.isArray(found?.supportedGenerationMethods)?found.supportedGenerationMethods.filter(method=>typeof method==='string').slice(0,20):[];
  if(!found){result.errors.push('PROBE_MODEL_NOT_LISTED');return result;}
  if(!result.modelList.supportedMethods.includes('countTokens'))result.errors.push('PROBE_COUNTTOKENS_UNSUPPORTED');
  if(!result.modelList.supportedMethods.includes('generateContent'))result.errors.push('PROBE_GENERATECONTENT_UNSUPPORTED');
  if(result.errors.length)return result;
  const counted=await request(baseUrl+'/models/'+model+':countTokens',{
   method:'POST',
   body:JSON.stringify({generateContentRequest:{model:'models/'+model,contents:[{role:'user',parts:[{text:'Uvenaro readiness probe. Do not generate a response.'}]}]}})
  });
  result.countTokens.status=counted.response.status;
  if(!counted.response.ok){result.errors.push('PROBE_COUNTTOKENS_HTTP_ERROR');return result;}
  const total=counted.body?.totalTokens;
  if(!Number.isSafeInteger(total)||total<1){result.errors.push('PROBE_COUNTTOKENS_RESPONSE_INVALID');return result;}
  result.countTokens.totalTokens=total;
  result.usage.countTokensNonbillableVerified=true;
  result.usage.totalTokens=total;
  result.verified=true;
  return result;
 }catch(error){
  result.errors.push(errorCode(error));
  return result;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report=await runGeminiProjectProbe({
  apiKey:process.env.GEMINI_API_KEY,
  model:process.env.GEMINI_PROBE_MODEL||DEFAULT_MODEL
 });
 console.log(JSON.stringify(report,null,2));
 if(!report.verified)process.exitCode=1;
}
