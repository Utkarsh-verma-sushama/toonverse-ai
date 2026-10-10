import {pathToFileURL} from 'node:url';

const API_KEYS_BASE_URL='https://apikeys.googleapis.com/v2';
const MAX_BODY_BYTES=65536;

function validSecret(value){return typeof value==='string'&&value.length>=20&&value.length<=256&&!/[\r\n]/.test(value);}
function validToken(value){return typeof value==='string'&&value.length>=20&&value.length<=8192&&!/[\r\n]/.test(value);}
function validProjectNumber(value){return typeof value==='string'&&/^\d{6,20}$/.test(value);}
async function readJson(response){
 const text=await response.text();
 if(text.length>MAX_BODY_BYTES)throw new Error('LOOKUP_RESPONSE_TOO_LARGE');
 try{return JSON.parse(text);}catch{throw new Error('LOOKUP_RESPONSE_NOT_JSON');}
}
function errorCode(error){
 return error?.message==='LOOKUP_RESPONSE_TOO_LARGE'||error?.message==='LOOKUP_RESPONSE_NOT_JSON'?error.message:'LOOKUP_NETWORK_ERROR';
}

export async function lookupGeminiKeyProject({apiKey,accessToken,expectedProjectNumber,quotaProject,fetcher=fetch}={}){
 const normalizedAccessToken=typeof accessToken==='string'?accessToken.trim():accessToken;
 const resolvedQuotaProject=typeof quotaProject==='string'&&quotaProject.trim()?quotaProject.trim():(process.env.GEMINI_PROJECT_ID||'toonverse-ai');
 const result={
  protocol:'uvenaro-gemini-key-project-lookup-v1',
  provider:'google-gemini',
  source:'google-api-keys-lookupKey',
  generationCalled:false,
  providerRequestsPermitted:false,
  billingChanged:false,
  activationAuthorized:false,
  verified:false,
  errors:[],
  credential:{name:'GEMINI_API_KEY',keyPresent:false,rawKeyLogged:false},
  oauth:{accessTokenPresent:false,rawTokenLogged:false},
  lookup:{status:null,parent:null,parentVerified:false,keyResourcePresent:false},
  project:{expectedNumber:expectedProjectNumber||null,matched:false}
 };
 if(!validSecret(apiKey)){result.errors.push('LOOKUP_API_KEY_INVALID');return result;}
 result.credential.keyPresent=true;
 if(!validToken(normalizedAccessToken)){ result.errors.push('LOOKUP_OAUTH_TOKEN_MISSING_OR_INVALID');return result;}
 result.oauth.accessTokenPresent=true;
 if(!validProjectNumber(expectedProjectNumber)){result.errors.push('LOOKUP_PROJECT_NUMBER_INVALID');return result;}
 const expectedParent='projects/'+expectedProjectNumber+'/locations/global';
 const url=API_KEYS_BASE_URL+'/keys:lookupKey?keyString='+encodeURIComponent(apiKey);
 try{
  const response=await fetcher(url,{method:'GET',redirect:'error',headers:{authorization:'Bearer '+normalizedAccessToken,'x-goog-user-project':resolvedQuotaProject,accept:'application/json'}});
  result.lookup.status=response.status;
  const body=await readJson(response);
  const parent=typeof body?.parent==='string'?body.parent:null;
  result.lookup.parent=parent;
  result.lookup.parentVerified=Boolean(response.ok&&parent===expectedParent);
  result.lookup.keyResourcePresent=typeof body?.name==='string'&&body.name.startsWith(expectedParent+'/keys/');
  result.project.matched=result.lookup.parentVerified&&result.lookup.keyResourcePresent;
  result.verified=result.project.matched;
  if(!response.ok)result.errors.push('LOOKUP_HTTP_ERROR');
  if(!result.lookup.parentVerified)result.errors.push('LOOKUP_PROJECT_MISMATCH');
  if(!result.lookup.keyResourcePresent)result.errors.push('LOOKUP_KEY_RESOURCE_MISSING');
  return result;
 }catch(error){result.errors.push(errorCode(error));return result;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report=await lookupGeminiKeyProject({
  apiKey:process.env.GEMINI_API_KEY,
  accessToken:process.env.GOOGLE_CLOUD_READONLY_TOKEN,
  expectedProjectNumber:process.env.GEMINI_PROJECT_NUMBER
 });
 console.log(JSON.stringify(report,null,2));
 if(!report.verified)process.exitCode=1;
}
