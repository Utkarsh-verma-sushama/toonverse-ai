import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectCloudflareAccess} from './check-cloudflare-access.mjs';
const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'private-server-token',UVENARO_STAGING_DATABASE_ID:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'};
test('missing credentials report only variable names and make no request',async()=>{
 let calls=0;const report=await inspectCloudflareAccess({},()=>{calls++;});assert.equal(calls,0);assert.equal(report.configured,false);assert.equal(report.remoteChangesPerformed,false);
 assert.deepEqual(report.missing,Object.keys(env));
});
test('existing GitHub credentials authorize only read-only metadata checks',async()=>{
 const report=await inspectCloudflareAccess(env,async(url,options)=>{
  assert.equal(options.method,undefined);assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer private-server-token');
  return Response.json({success:true,result:url.endsWith('/workers/services')?[]:{name:'uvenaro-account-staging',uuid:env.UVENARO_STAGING_DATABASE_ID}});
 });assert.equal(report.workersRead,true);assert.equal(report.existingStagingDatabaseRead,true);assert.equal(report.writePermissionsVerified,false);
 assert.doesNotMatch(JSON.stringify(report),/private-server-token/);
});
for(const status of [401,403,429,500])test('Cloudflare HTTP '+status+' suppresses raw credential-bearing errors',async()=>{
 const report=await inspectCloudflareAccess(env,async()=>new Response('private-server-token',{status}));
 assert.equal(report.workersRead,false);assert.doesNotMatch(JSON.stringify(report),/private-server-token/);
});
test('network and HTML failures are safe and do not become authorization success',async()=>{
 for(const fetcher of [async()=>{throw Error('private-server-token');},async()=>new Response('<html>private-server-token</html>')]){
  const report=await inspectCloudflareAccess(env,fetcher);assert.equal(report.workersRead,false);assert.doesNotMatch(JSON.stringify(report),/private-server-token/);
 }
});
test('a different database identity cannot validate staging access',async()=>{
 const report=await inspectCloudflareAccess(env,async()=>Response.json({success:true,result:{name:'production',uuid:env.UVENARO_STAGING_DATABASE_ID}}));
 assert.equal(report.existingStagingDatabaseRead,false);assert.ok(report.errors.includes('STAGING_DATABASE_IDENTITY_MISMATCH'));
});
test('access workflow reuses existing environment without deployment or dependency execution',()=>{
 const source=readFileSync(new URL('../.github/workflows/cloudflare-access-check.yml',import.meta.url),'utf8');
 assert.match(source,/environment: uvenaro-account-staging/);assert.match(source,/node scripts\/check-cloudflare-access\.mjs/);
 assert.doesNotMatch(source,/wrangler|npm ci|npm install|pull_request|contents: write/);
});
