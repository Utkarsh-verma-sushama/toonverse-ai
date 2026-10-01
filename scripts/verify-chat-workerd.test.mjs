// Run the bounded provider-body reader in workerd, where network streams and
// cancellation differ from Node. All provider/identity traffic stays in fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {schema,migration,cfg} from './billing-fixtures.mjs';
import {accountMigration,accountEnv,accountHeaders,identityService} from './account-fixtures.mjs';
import {jwk,token,seconds} from './security-fixtures.mjs';
const replay=readFileSync(new URL('../backend/migrations/0004_request_replay_guard.sql',import.meta.url),'utf8');
function statements(){
 const parser=new DatabaseSync(':memory:'),queries=[];let pending='';
 try{for(const line of (schema+'\n'+migration+'\n'+accountMigration+'\n'+replay).split('\n')){
  if(!line.trim()||line.trim().startsWith('--'))continue;pending+=line+'\n';if(!line.trim().endsWith(';'))continue;
  try{parser.exec(pending);}catch(error){if(error.message.includes('incomplete input'))continue;throw error;}
  if(!pending.trim().startsWith('PRAGMA'))queries.push(pending);pending='';
 }assert.equal(pending,'');return queries;}finally{parser.close();}
}
async function harness(t,gateway){
 const origin='https://chat.uvenaro.invalid',identity=await identityService();let calls=0;
 const mf=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('../backend/worker.mjs',import.meta.url)),compatibilityDate:'2026-08-06',
  bindings:{...accountEnv,ALLOWED_ORIGINS:origin,ENVIRONMENT:'test',CHAT_EXECUTION_ENABLED:'true',CHAT_PROVIDER:cfg.provider,CHAT_MODEL:cfg.model,
   CHAT_PROVIDER_URL:'https://gateway.invalid/responses',CHAT_PROVIDER_ALLOWED_ORIGIN:'https://gateway.invalid',CHAT_PROVIDER_PROTOCOL:'metered-v1',CHAT_PROVIDER_API_KEY:'fixture-secret',
   CHAT_MAX_INPUT_TOKENS:'100',CHAT_MAX_OUTPUT_TOKENS:'50',CHAT_GLOBAL_DAILY_COST_MICROUSD:'100000',CHAT_TIMEOUT_MS:'1000',REPLAY_PROTECTION_ENABLED:'true',
   APP_CHECK_ENFORCEMENT_ENABLED:'true',FIREBASE_PROJECT_NUMBER:'123',APP_CHECK_ALLOWED_APP_IDS:'1:123:web:allowed'},d1Databases:{DB:'chat-workerd'},
  outboundService:async request=>{
   const url=new URL(request.url);
   if(url.hostname==='gateway.invalid'){calls++;assert.equal(request.headers.get('authorization'),'Bearer fixture-secret');return gateway(await request.json());}
   if(url.hostname==='firebaseappcheck.googleapis.com')return Response.json({keys:[jwk]});
   assert.ok(['identitytoolkit.googleapis.com','securetoken.googleapis.com','www.googleapis.com'].includes(url.hostname));
   return identity.fetch(request.url,{headers:Object.fromEntries(request.headers),body:await request.text()});
  }});
 t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');await DB.batch(statements().map(q=>DB.prepare(q)));
 const now=new Date().toISOString(),start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
 await DB.batch([
  DB.prepare('INSERT INTO billing_accounts VALUES (?,?,?,?,?,?,?,?,?)').bind('alice','free','active',20,80,0,start,end,now),
  DB.prepare('INSERT INTO usage_limits VALUES (?,?,?,?,?,?,?)').bind('alice',1000,10000,100000,1000,null,now),
  DB.prepare('INSERT INTO chat_billing_policy VALUES (?,?,?,?)').bind('chat',1,100000,now),
  DB.prepare('INSERT INTO provider_price_snapshots VALUES (?,?,?,?,?,?,?,?,?)').bind('price',cfg.provider,cfg.model,1000000,1000000,10,start,null,end)
 ]);
 const at=seconds(),attestation=await token({iss:'https://firebaseappcheck.googleapis.com/123',aud:['projects/123'],sub:'1:123:web:allowed',iat:at-1,exp:at+300},{alg:'RS256',typ:'JWT',kid:jwk.kid});
 const headers={...accountHeaders,origin,'x-firebase-appcheck':attestation};
 const login=await mf.dispatchFetch(origin+'/v1/auth/sign-in',{method:'POST',headers,body:JSON.stringify({email:'alice@example.com',password:'local-fixture-password'})});
 assert.equal(login.status,200);headers.authorization='Bearer '+(await login.json()).accessToken;
 const send=()=>mf.dispatchFetch(origin+'/v1/chat/responses',{method:'POST',headers:{...headers,'idempotency-key':'workerd-key','x-uvenaro-nonce':crypto.randomUUID()},body:JSON.stringify({message:'Hello'})});
 const receipt=()=>mf.dispatchFetch(origin+'/v1/chat/requests/workerd-key',{headers});
 return {DB,send,receipt,get calls(){return calls;}};
}
test('workerd settles metered usage with App Check and nonce protection enabled',async t=>{
 const h=await harness(t,input=>Response.json({id:'provider-id',request_id:input.request_id,model:input.model,status:'completed',output:'Answer',usage:{input_tokens:10,output_tokens:5}}));
 const response=await h.send();assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).usage.credits,2);
 assert.equal((await h.send()).status,409);assert.equal(h.calls,1);assert.equal((await (await h.receipt()).json()).status,'settled');
});
test('workerd stops a stalled response body and keeps its uncertain credits held',{timeout:10000},async t=>{
 const h=await harness(t,()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));}})));
 const response=await h.send();assert.equal(response.status,503);assert.equal((await response.json()).code,'RECONCILIATION_REQUIRED');
 const receipt=await (await h.receipt()).json();assert.equal(receipt.status,'reserved');assert.equal(receipt.reservedCredits,15);assert.equal(receipt.reconciliationRequired,true);
 assert.equal((await h.send()).status,409);assert.equal(h.calls,1);
});
