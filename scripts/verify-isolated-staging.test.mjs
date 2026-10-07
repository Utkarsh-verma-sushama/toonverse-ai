import test from 'node:test';
import assert from 'node:assert/strict';
import {declaredScopes,inventoryPlan,inspectIsolatedStaging,stagingNames} from './inspect-isolated-staging.mjs';
import {readFileSync} from 'node:fs';
const account='a'.repeat(32),pilot='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',tokenId='b'.repeat(32);
const env={CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'private-fixture-token',UVENARO_STAGING_DATABASE_ID:pilot};
const policy={effect:'allow',resources:{['com.cloudflare.api.account.'+account]:'*'},permission_groups:[{name:'Workers Scripts Write'},{name:'D1 Write'}]};
const dbs=[{name:'uvenaro-account-staging',uuid:pilot}];
function metadata(path){
 if(path.includes('/d1/database?'))return {success:true,result:dbs,result_info:{total_count:1}};
 if(path.endsWith('/workers/services'))return {success:true,result:[]};
 if(path.endsWith('/tokens/verify'))return {success:true,result:{id:tokenId,status:'active'}};
 if(path.endsWith('/tokens/'+tokenId))return {success:true,result:{policies:[policy]}};
 if(path.endsWith('/subscriptions'))return {success:true,result:[{price:0,rate_plan:{id:'free',public_name:'Workers Free',is_contract:false,externally_managed:false}}],result_info:{total_count:1}};
 throw Error('Unexpected fixture request');
}
test('preflight proves declared scopes and free plan using GET metadata only',async()=>{
 const calls=[];const result=await inspectIsolatedStaging(env,async(url,options)=>{
  calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return Response.json(metadata(new URL(url).pathname+new URL(url).search));
 });assert.equal(result.readyForProvisioning,true);assert.equal(result.writePermissionsExercised,false);assert.equal(result.remoteChangesPerformed,false);assert.equal(calls.length,5);
 assert.doesNotMatch(JSON.stringify(result),/private-fixture-token|aaaaaaaa-bbbb|bbbbbbbbbbbb/);
});
for(const [name,policies] of Object.entries({missing:null,read:[{...policy,permission_groups:[{name:'Workers Scripts Read'},{name:'D1 Read'}]}],foreign:[{...policy,resources:{'com.cloudflare.api.account.foreign':'*'}}],individual:[{...policy,resources:{['com.cloudflare.api.account.'+account]:{worker:'existing'}}}],deny:[policy,{effect:'deny'}]}))test(name+' cannot prove new resource write scopes',()=>{
 const scope=declaredScopes({policies},account);assert.equal(scope.workersCreateDeclared,false);assert.equal(scope.d1WriteDeclared,false);
});
test('complete inventory preserves pilot and accepts three distinct new DB names',()=>{
 const result=inventoryPlan(dbs,[],pilot);assert.equal(result.pilotPreserved,true);assert.deepEqual(result.blockers,[]);assert.equal(new Set(stagingNames.databases).size,3);
});
test('existing targets, wrong pilot and insufficient free slots are blockers',()=>{
 assert.ok(inventoryPlan([...dbs,{name:stagingNames.databases[0],uuid:'new'}],[{id:stagingNames.workers[0]}],pilot).blockers.includes('EXISTING_TARGET_RESOURCE_REQUIRES_OWNERSHIP_REVIEW'));
 assert.ok(inventoryPlan([],[],pilot).blockers.includes('PILOT_IDENTITY_MISMATCH'));
 assert.ok(inventoryPlan([...dbs,...Array.from({length:7},(_,i)=>({uuid:'id'+i,name:'db'+i}))],[],pilot).blockers.includes('FREE_DATABASE_CAPACITY_UNAVAILABLE'));
});
for(const [name,change] of Object.entries({empty:{result:[],result_info:{total_count:0}},paid:{result:[{price:5,rate_plan:{id:'pro',public_name:'Workers Paid'}}],result_info:{total_count:1}},other:{result:[{price:0,rate_plan:{id:'free',public_name:'DNS Free'}}],result_info:{total_count:1}},truncated:{result:[],result_info:{total_count:2}}}))test(name+' subscriptions do not authorize zero-cost provisioning',async()=>{
 const result=await inspectIsolatedStaging(env,async url=>Response.json(String(url).endsWith('/subscriptions')?{success:true,...change}:metadata(new URL(url).pathname+new URL(url).search)));
 assert.equal(result.workersFreePlanVerified,false);assert.equal(result.readyForProvisioning,false);
});
test('denied token details preserve working reads but leave scopes unknown',async()=>{
 const result=await inspectIsolatedStaging(env,async url=>String(url).endsWith('/tokens/'+tokenId)?new Response('private-fixture-token',{status:403}):Response.json(metadata(new URL(url).pathname+new URL(url).search)));
 assert.equal(result.inventory.inventoryVerified,true);assert.equal(result.tokenActive,true);assert.equal(result.scopes.inspectable,false);assert.equal(result.readyForProvisioning,false);
 assert.doesNotMatch(JSON.stringify(result),/private-fixture-token/);
});
test('account token verification can safely fall back to user token verification',async()=>{
 const result=await inspectIsolatedStaging(env,async url=>String(url).includes('/accounts/'+account+'/tokens/verify')?new Response('denied',{status:403}):Response.json(metadata(new URL(url).pathname+new URL(url).search)));
 assert.equal(result.tokenActive,true);assert.equal(result.scopes.workersCreateDeclared,true);
});
test('partial database inventory cannot justify quota or absence of collisions',async()=>{
 const result=await inspectIsolatedStaging(env,async url=>Response.json(String(url).includes('/d1/database?')?{success:true,result:dbs,result_info:{total_count:9}}:metadata(new URL(url).pathname+new URL(url).search)));
 assert.equal(result.inventory.inventoryVerified,false);assert.equal(result.readyForProvisioning,false);
});
test('missing configuration makes no network call',async()=>{
 let calls=0;assert.equal((await inspectIsolatedStaging({},()=>{calls++;})).readyForProvisioning,false);assert.equal(calls,0);
});
test('HTML, API and network errors never leak response bodies or tokens',async()=>{
 for(const reply of [()=>new Response('<html>private-fixture-token</html>'),()=>Response.json({success:false,errors:[{message:'private-fixture-token'}]}),()=>{throw Error('private-fixture-token');}]){
  const result=await inspectIsolatedStaging(env,reply);assert.equal(result.readyForProvisioning,false);assert.doesNotMatch(JSON.stringify(result),/private-fixture-token/);
 }
});
test('inspection workflow never provisions resources or installs project dependencies',()=>{
 const source=readFileSync(new URL('../.github/workflows/cloudflare-access-check.yml',import.meta.url),'utf8');
 assert.match(source,/node scripts\/inspect-isolated-staging.mjs/);assert.doesNotMatch(source,/wrangler|npm ci|npm install|contents: write/);
});
test('subscription request uses the documented path without unsupported query fields',async()=>{
 let seen=false;
 const result=await inspectIsolatedStaging(env,async url=>{
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/subscriptions')){seen=true;assert.equal(parsed.search,'');}
  return Response.json(metadata(parsed.pathname+parsed.search));
 });assert.equal(seen,true);assert.equal(result.readyForProvisioning,true);
});
test('subscription errors expose only bounded numeric diagnostics and never authorize provisioning',async()=>{
 const result=await inspectIsolatedStaging(env,async url=>String(url).endsWith('/subscriptions')?
  Response.json({errors:[{code:1234,message:'private-fixture-token'},{code:'private-fixture-token'},{code:5}]},{status:400}):Response.json(metadata(new URL(url).pathname+new URL(url).search)));
 assert.equal(result.freePlanHttpStatus,400);assert.deepEqual(result.freePlanApiErrorCodes,[1234,5]);
 assert.equal(result.readyForProvisioning,false);assert.doesNotMatch(JSON.stringify(result),/private-fixture-token/);
});
