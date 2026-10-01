// Exercise outbound fetch in the actual Workers runtime. Node's fetch accepts
// redirect:'error', but workerd rejects it before any request reaches Firebase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {schema,migration} from './billing-fixtures.mjs';
import {accountMigration,accountEnv,accountHeaders,identityService} from './account-fixtures.mjs';
import {jwk,token,seconds} from './security-fixtures.mjs';

const origin='https://uvenaro-account-staging.test.workers.dev';
const scriptPath=fileURLToPath(new URL('../backend/staging-worker.mjs',import.meta.url));
const sql=schema+'\n'+migration+'\n'+accountMigration;
function statements(){
 const parser=new DatabaseSync(':memory:'),queries=[];let pending='';
 try{
  for(const line of sql.split('\n')){
   if(!line.trim()||line.trim().startsWith('--'))continue;
   pending+=line+'\n';if(!line.trim().endsWith(';'))continue;
   try{parser.exec(pending);}catch(error){if(error.message.includes('incomplete input'))continue;throw error;}
   if(!pending.trim().startsWith('PRAGMA'))queries.push(pending);pending='';
  }
  assert.equal(pending,'');return queries;
 }finally{parser.close();}
}
const queries=statements();
async function harness(t,{appCheck=false}={}){
 const provider=await identityService(),calls=[];
 const state={redirectPath:'',redirectStatus:307};
 const mf=new Miniflare({modules:true,scriptPath,compatibilityDate:'2026-08-06',
  bindings:{...accountEnv,ENVIRONMENT:'staging',STAGING_ORIGIN:origin,STAGING_ALLOWED_EMAILS:'alice@example.com',
   APP_CHECK_ENFORCEMENT_ENABLED:String(appCheck),FIREBASE_PROJECT_NUMBER:'123',APP_CHECK_ALLOWED_APP_IDS:'1:123:web:allowed'},
  d1Databases:{DB:'account-workerd-regression'},
  outboundService:async request=>{
   const url=new URL(request.url);calls.push({host:url.hostname,path:url.pathname});
   assert.ok(['identitytoolkit.googleapis.com','securetoken.googleapis.com','www.googleapis.com','firebaseappcheck.googleapis.com'].includes(url.hostname),'credentials must never reach a redirect target');
   if(state.redirectPath&&url.pathname.includes(state.redirectPath))return new Response('private upstream body',{status:state.redirectStatus,headers:{location:'https://redirect.invalid/credential-sink'}});
   if(url.hostname==='firebaseappcheck.googleapis.com')return Response.json({keys:[jwk]});
   return provider.fetch(request.url,{headers:Object.fromEntries(request.headers),body:await request.text()});
  }});
 t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB');await DB.batch(queries.map(query=>DB.prepare(query)));
 let cookie='',access='',attestation='';
 if(appCheck){const now=seconds();attestation=await token({iss:'https://firebaseappcheck.googleapis.com/123',aud:['projects/123'],sub:'1:123:web:allowed',iat:now-1,exp:now+300},{alg:'RS256',typ:'JWT',kid:jwk.kid});}
 async function call(path,{body={},method='POST'}={}){
  const response=await mf.dispatchFetch(origin+path,{method,headers:{...accountHeaders,origin,
   ...(cookie?{cookie}:{}),...(access?{authorization:'Bearer '+access}:{}),...(attestation?{'x-firebase-appcheck':attestation}:{})},
   ...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  if(data.accessToken)access=data.accessToken;
  return {response,data,cookie};
 }
 const login=()=>call('/api/v1/auth/sign-in',{body:{email:'alice@example.com',password:'fixture-only-password'}});
 return {provider,state,calls,DB,call,login};
}

test('Workers completes Firebase login, key verification, account lookup and refresh',async t=>{
 const h=await harness(t),signed=await h.login();
 assert.equal(signed.response.status,200,JSON.stringify(signed.data));assert.equal(signed.data.user.id,'alice');
 assert.match(signed.data.accessToken,/^uv1\./);assert.equal(signed.data.idToken,undefined);assert.equal(signed.data.refreshToken,undefined);
 assert.match(signed.response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const profile=await h.call('/api/v1/account/profile',{method:'GET'});assert.equal(profile.response.status,200);
 const refreshed=await h.call('/api/v1/auth/refresh');assert.equal(refreshed.response.status,200,JSON.stringify(refreshed.data));assert.notEqual(refreshed.cookie,signed.cookie);
 for(const path of ['accounts:signInWithPassword','/jwk/','accounts:lookup','/v1/token'])assert.ok(h.calls.some(call=>call.path.includes(path)),path);
});

test('Workers returns credential rejection rather than a transport 503',async t=>{
 const h=await harness(t);h.provider.failure='INVALID_LOGIN_CREDENTIALS';
 const out=await h.login();assert.equal(out.response.status,401);assert.equal(out.data.code,'INVALID_CREDENTIALS');
 assert.equal(h.calls.length,1);assert.equal((await h.DB.prepare('SELECT COUNT(*) AS n FROM account_sessions').first()).n,0);
});

for(const status of [301,302,303,307,308])test(`Workers blocks Firebase ${status} redirects without forwarding credentials`,async t=>{
 const h=await harness(t);h.state.redirectPath='accounts:signInWithPassword';h.state.redirectStatus=status;
 const out=await h.login();assert.equal(out.response.status,503);assert.equal(out.data.code,'IDENTITY_UNAVAILABLE');
 assert.equal(h.calls.length,1);assert.doesNotMatch(JSON.stringify(out.data),/credential-sink|private upstream|fixture-only/);
 assert.equal((await h.DB.prepare('SELECT COUNT(*) AS n FROM account_sessions').first()).n,0);
});

for(const path of ['/jwk/','accounts:lookup'])test(`Workers rejects redirects during identity validation: ${path}`,async t=>{
 const h=await harness(t);h.state.redirectPath=path;
 const out=await h.login();assert.equal(out.response.status,503);
 assert.equal((await h.DB.prepare('SELECT COUNT(*) AS n FROM account_sessions').first()).n,0);
});

test('Workers App Check accepts signed tokens and fetches keys without runtime errors',async t=>{
 const h=await harness(t,{appCheck:true}),out=await h.login();
 assert.equal(out.response.status,200,JSON.stringify(out.data));assert.ok(h.calls.some(call=>call.host==='firebaseappcheck.googleapis.com'));
});

test('Workers blocks an App Check key redirect before sending account credentials',async t=>{
 const h=await harness(t,{appCheck:true});h.state.redirectPath='/v1/jwks';
 const out=await h.login();assert.equal(out.response.status,503);assert.equal(out.data.code,'APP_ATTESTATION_UNAVAILABLE');assert.equal(h.calls.length,1);
});

test('Workers refuses a refresh redirect and never forwards the refresh token',async t=>{
 const h=await harness(t);assert.equal((await h.login()).response.status,200);
 h.state.redirectPath='/v1/token';const before=h.calls.length;
 const out=await h.call('/api/v1/auth/refresh');assert.equal(out.response.status,503);assert.equal(h.calls.length,before+1);
});
