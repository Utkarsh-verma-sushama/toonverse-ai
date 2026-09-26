import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import staging,{stagingEnvironment} from '../backend/staging-worker.mjs';
import {accountDatabase,accountEnv,accountHeaders,identityService} from './account-fixtures.mjs';
import {buildStaging} from './prepare-account-staging.mjs';
import {deploymentInputs,requireStagingDatabase,verifyRemoteDatabase} from './deploy-account-staging.mjs';
const origin='https://uvenaro-account-staging.test.workers.dev',previousFetch=globalThis.fetch;let db,provider,env,jar,token;
beforeEach(async()=>{db=accountDatabase();provider=await identityService();globalThis.fetch=provider.fetch;jar='';token='';env={...accountEnv,...db,ENVIRONMENT:'staging',STAGING_ORIGIN:origin,STAGING_ALLOWED_EMAILS:'alice@example.com',ASSETS:{fetch:async()=>new Response('<h1>account</h1>',{headers:{'content-type':'text/html'}})}};});
afterEach(()=>{globalThis.fetch=previousFetch;db.sql.close();});
async function call(path,{method='POST',body={},headers={},bindings={}}={}){
 const response=await staging.fetch(new Request(origin+path,{method,headers:{...accountHeaders,origin,...(jar?{cookie:jar}:{}),...(token?{authorization:'Bearer '+token}:{}),...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})}),{...env,...bindings});
 if(response.headers.has('set-cookie'))jar=response.headers.get('set-cookie').split(';')[0];return {response,body:await response.json()};
}
async function login(){const out=await call('/api/v1/auth/sign-in',{body:{email:'alice@example.com',password:'a long test password'}});assert.equal(out.response.status,200,JSON.stringify(out.body));token=out.body.accessToken;return out;}
test('staging requires explicit non-production origin and exact pilot emails',async()=>{
 for(const bindings of [{ENVIRONMENT:'production'},{STAGING_ORIGIN:'https://uvenaro.com'},{STAGING_ORIGIN:'https://www.uvenaro.com'},{STAGING_ORIGIN:'http://insecure.invalid'},{STAGING_ALLOWED_EMAILS:''},{STAGING_ALLOWED_EMAILS:'*@example.com'}])assert.equal((await call('/api/v1/health',{method:'GET',bindings})).response.status,503);
 assert.equal(provider.providerCalls,0);
});
test('staging wrapper cannot enable creative execution or authenticator enrollment',async()=>{
 const safe=stagingEnvironment({...env,CHAT_EXECUTION_ENABLED:'true',AGENT_EXECUTION_ENABLED:'true',MODEL_ROUTING_ENABLED:'true',ACCOUNT_TOTP_ENABLED:'true'},origin);
 for(const key of ['CHAT_EXECUTION_ENABLED','AGENT_EXECUTION_ENABLED','MODEL_ROUTING_ENABLED','ACCOUNT_TOTP_ENABLED'])assert.equal(safe[key],'false');
 for(const path of ['/api/v1/chat/responses','/api/v1/agents/runs','/api/v1/ai/routes','/v1/auth/sign-in'])assert.equal((await call(path,{method:'GET'})).response.status,404);
 assert.equal(provider.providerCalls,0);
});
test('health distinguishes configured schema from live provider validation and reveals no secrets',async()=>{
 let out=await call('/api/v1/health',{method:'GET'});assert.equal(out.body.accountReady,true);assert.equal(out.body.providerChecked,false);
 assert.deepEqual(Object.keys(out.body).sort(),['accountReady','ok','providerChecked','service']);assert.equal(provider.providerCalls,0);
 for(const bindings of [{ACCOUNT_AUTH_ENABLED:'false'},{ACCOUNT_SESSION_KEY:''},{DB:undefined}])assert.equal((await call('/api/v1/health',{method:'GET',bindings})).body.accountReady,false);
 db.sql.exec('DROP TABLE account_rate_limits');assert.equal((await call('/api/v1/health',{method:'GET'})).body.accountReady,false);
});
test('pilot login, cookie rotation and logout work through the real same-origin API prefix',async()=>{
 const signed=await login();assert.match(signed.response.headers.get('set-cookie'),/__Host-uvenaro-session=.*HttpOnly; Secure/);
 assert.equal((await call('/api/v1/account/profile',{method:'GET'})).body.user.id,'alice');
 const before=jar;const refreshed=await call('/api/v1/auth/refresh');assert.equal(refreshed.response.status,200);assert.notEqual(jar,before);token=refreshed.body.accessToken;
 assert.equal((await call('/api/v1/auth/sign-out')).response.status,200);assert.equal((await call('/api/v1/account/profile',{method:'GET'})).response.status,401);
});
test('non-pilot registration and sign-in never call the real identity provider',async()=>{
 for(const action of ['register','sign-in'])assert.equal((await call('/api/v1/auth/'+action,{body:{email:'outsider@example.com',name:'Outsider',password:'a long test password'}})).body.code,'ACCOUNT_NOT_IN_PILOT');
 assert.equal(provider.providerCalls,0);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM account_sessions').get().n,0);
});
test('recovery for non-pilot addresses remains generic and never sends email',async()=>{
 const outside=await call('/api/v1/auth/password/reset/request',{body:{email:'outsider@example.com'}});assert.equal(outside.response.status,200);assert.equal(provider.providerCalls,0);
 const inside=await call('/api/v1/auth/password/reset/request',{body:{email:'alice@example.com',continueUrl:'https://untrusted.invalid'}});assert.deepEqual(outside.body,inside.body);
 assert.equal(provider.calls.at(-1).input.continueUrl,origin+'/account.html');assert.equal(provider.calls.at(-1).input.canHandleCodeInApp,false);
});
test('removing an email from the pilot revokes its ability to use an existing session',async()=>{
 await login();const bindings={STAGING_ALLOWED_EMAILS:'bob@example.com'};
 assert.equal((await call('/api/v1/account/profile',{method:'GET',bindings})).body.code,'ACCOUNT_NOT_IN_PILOT');
 assert.equal((await call('/api/v1/auth/refresh',{bindings})).response.status,403);
 assert.ok(db.sql.prepare('SELECT revoked_at FROM account_sessions').get().revoked_at);
});
test('pilot users cannot change their email to an unapproved address',async()=>{
 await login();const count=provider.providerCalls;
 assert.equal((await call('/api/v1/auth/email/change/request',{body:{email:'outsider@example.com'}})).body.code,'ACCOUNT_NOT_IN_PILOT');assert.equal(provider.providerCalls,count);
});
test('untrusted origin cannot exploit prefix routing or forwarded-host headers',async()=>{
 const out=await call('/api/v1/auth/sign-in',{headers:{origin:'https://untrusted.invalid','x-forwarded-host':'uvenaro.com'},body:{email:'alice@example.com',password:'a long test password'}});assert.equal(out.response.status,403);assert.equal(provider.providerCalls,0);
});
function codeReply(reply){const original=provider.fetch;globalThis.fetch=(url,options)=>String(url).includes('accounts:resetPassword')?Promise.resolve(Response.json(reply)):original(url,options);}
test('email action scope comes from checked provider code, not caller-supplied email',async()=>{
 codeReply({requestType:'VERIFY_EMAIL',email:'outsider@example.com'});
 const out=await call('/api/v1/auth/email/verify/confirm',{body:{oobCode:'a-valid-action-code',email:'alice@example.com'}});assert.equal(out.body.code,'ACCOUNT_NOT_IN_PILOT');assert.equal(provider.providerCalls,0);
});
test('verified email changes support Firebase action codes with only a new email',async()=>{
 codeReply({requestType:'VERIFY_AND_CHANGE_EMAIL',newEmail:'alice@example.com'});
 assert.equal((await call('/api/v1/auth/email/verify/confirm',{body:{oobCode:'a-valid-action-code'}})).response.status,200);assert.ok(provider.calls.at(-1).url.includes('/v1/accounts:update'));
});
test('password reset cannot change a non-pilot account even with a valid code',async()=>{
 codeReply({requestType:'PASSWORD_RESET',email:'outsider@example.com'});
 const out=await call('/api/v1/auth/password/reset/confirm',{body:{oobCode:'a-valid-action-code',newPassword:'a new long password'}});assert.equal(out.body.code,'ACCOUNT_NOT_IN_PILOT');assert.equal(provider.providerCalls,0);
});
test('staging pages have response security headers and cannot install a service worker',async()=>{
 const response=await staging.fetch(new Request(origin+'/account.html'),env);assert.equal(response.status,200);
 for(const [key,value] of [['cache-control','no-store'],['referrer-policy','no-referrer'],['x-frame-options','DENY']])assert.equal(response.headers.get(key),value);
 assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(response.headers.get('x-robots-tag'),/noindex/);
 assert.equal((await call('/sw.js',{method:'GET'})).response.status,410);assert.equal((await call('/.env',{method:'GET'})).response.status,404);
});
test('staging migration chain is D1-compatible in Miniflare, not only SQLite',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'uvenaro-staging-d1-'));const mf=new (await import('miniflare')).Miniflare({workers:[{name:'migration-chain',modules:true,script:'export default {fetch(){return new Response("ok");}}',compatibilityDate:'2026-08-06',d1Databases:{DB:'staging-migration-chain'}}]});
 try{
  const {migrations}=await buildStaging(dir);const DB=await mf.getD1Database('DB');
  const ordered=(await readdir(migrations)).sort();assert.deepEqual(ordered,['0000_baseline.sql','0001_atomic_chat_billing.sql','0002_account_sessions.sql']);
  const sql=(await Promise.all(ordered.map(file=>readFile(join(migrations,file),'utf8')))).join('\\n');
  // Exact proven parser pattern from verify-d1-billing.test.mjs.
  const parser=new DatabaseSync(':memory:');let pending='';const queries=[];
  try{for(const line of sql.split('\\n')){if(!line.trim()||line.trim().startsWith('--'))continue;pending+=line+'\\n';if(!line.trim().endsWith(';'))continue;try{parser.exec(pending);}catch(error){if(String(error.message).includes('incomplete input'))continue;throw error;}const complete=pending;pending='';if(!complete.trim().startsWith('PRAGMA'))queries.push(complete);}assert.equal(pending,'');}finally{parser.close();}
  assert.ok(queries.some(sql=>/CREATE TABLE account_sessions/i.test(sql)),'proven parser omitted account_sessions');
  await DB.batch(queries.map(sql=>DB.prepare(sql)));
  assert.equal((await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account_sessions'").first())?.name,'account_sessions');
 }finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
});

test('staging artifact includes only reviewed browser assets and fresh tracked migrations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'uvenaro-staging-'));const sql=new DatabaseSync(':memory:');
 try{
  const {publicDir,migrations}=await buildStaging(dir);const context={window:{},location:{origin}};
  vm.runInNewContext(await readFile(join(publicDir,'assets/js/config.js'),'utf8'),context);const config=context.window.UvenaroConfig;
  assert.equal(config.features.authentication,true);assert.equal(config.services.apiBaseUrl,origin+'/api');
  for(const flag of ['chatCore','cloudSync','cloudBackend','payments','autonomousAgents','multimodalModelRouting'])assert.equal(config.features[flag],false);
  assert.deepEqual((await readdir(publicDir)).sort(),['account.html','assets','index.html']);
  for(const file of (await readdir(migrations)).sort())sql.exec(await readFile(join(migrations,file),'utf8'));
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM account_sessions').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM billing_accounts').get().n,0);
  assert.ok(!(await readFile(join(publicDir,'account.html'),'utf8')).includes('manifest.webmanifest'));
 }finally{sql.close();await rm(dir,{recursive:true,force:true});}
});
const validSettings=()=>({CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test-token',UVENARO_STAGING_DATABASE_ID:'11111111-1111-4111-8111-111111111111',UVENARO_STAGING_ORIGIN:origin,UVENARO_STAGING_ALLOWED_EMAILS:'alice@example.com',ACCOUNT_SESSION_KEY:Buffer.from(Array.from({length:32},(_,i)=>i)).toString('base64url')});
test('deployment validates all required settings before any remote operation',()=>{
 assert.equal(deploymentInputs(validSettings()).enabled,false);
 for(const key of Object.keys(validSettings())){const settings=validSettings();delete settings[key];assert.throws(()=>deploymentInputs(settings),/Missing secure deployment settings/);}
 for(const patch of [{UVENARO_STAGING_ORIGIN:'https://uvenaro.com'},{UVENARO_STAGING_ORIGIN:'https://evil.invalid'},{UVENARO_STAGING_ALLOWED_EMAILS:'*@example.com'},{ACCOUNT_SESSION_KEY:'a'.repeat(43)}])assert.throws(()=>deploymentInputs({...validSettings(),...patch}));
});
test('database identity check refuses production or mismatched IDs before migrations',()=>{
 const id=validSettings().UVENARO_STAGING_DATABASE_ID;assert.doesNotThrow(()=>requireStagingDatabase({name:'uvenaro-account-staging',uuid:id},id));
 for(const info of [{name:'uvenaro-core',uuid:id},{name:'uvenaro-account-staging',uuid:'other'},null])assert.throws(()=>requireStagingDatabase(info,id),/Database identity mismatch/);
});

test('remote database check uses only the selected account/database and refuses redirects or API failure',async()=>{
 const input=deploymentInputs(validSettings());let observed;
 await verifyRemoteDatabase(input,'test-credential',async(url,options)=>{observed={url,options};return Response.json({success:true,result:{name:'uvenaro-account-staging',uuid:input.databaseId}});});
 assert.equal(observed.url,`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/d1/database/${input.databaseId}`);assert.equal(observed.options.redirect,'error');assert.equal(observed.options.headers.authorization,'Bearer test-credential');
 await assert.rejects(verifyRemoteDatabase(input,'test-credential',async()=>Response.json({success:false},{status:403})),/database identity check failed/);
 await assert.rejects(verifyRemoteDatabase(input,'test-credential',async()=>Response.json({success:true,result:{name:'production',uuid:input.databaseId}})),/Database identity mismatch/);
});
