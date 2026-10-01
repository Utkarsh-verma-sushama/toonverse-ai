import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkReleaseCi,requiredWorkflows,successfulRun} from './check-release-ci.mjs';

const repository='example/uvenaro',sha='a'.repeat(40),workflow='security-gate.yml';
const env={GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:repository,GITHUB_SHA:sha,GITHUB_TOKEN:'fixture-secret'};
const run=(overrides={})=>({id:1,run_number:10,run_attempt:1,path:'.github/workflows/'+workflow,event:'push',head_sha:sha,head_branch:'main',repository:{full_name:repository},head_repository:{full_name:repository},status:'completed',conclusion:'success',...overrides});
const payload=(...runs)=>({total_count:runs.length,workflow_runs:runs});
const options={repository,sha,workflow};

test('CI release gate accepts only the exact current main commit with all three workflows successful',async()=>{
 const calls=[];
 const result=await checkReleaseCi(env,async(url,init)=>{
  calls.push(url);assert.equal(init.redirect,'error');assert.ok(init.signal);assert.equal(init.headers.authorization,'Bearer fixture-secret');
  if(url.endsWith('/branches/main'))return Response.json({name:'main',commit:{sha}});
  const file=new URL(url).pathname.split('/').at(-2);assert.ok(requiredWorkflows.includes(file));
  return Response.json(payload(run({path:'.github/workflows/'+file})));
 });
 assert.equal(result.sha,sha);assert.equal(result.checks.length,3);assert.equal(calls.length,5);
 assert.ok(!JSON.stringify(result).includes(env.GITHUB_TOKEN));
});

for(const change of [{head_sha:'b'.repeat(40)},{head_branch:'feature'},{event:'pull_request'},{head_repository:{full_name:'untrusted/fork'}},{repository:{full_name:'other/repo'}},{path:'.github/workflows/unrelated.yml'}])test('CI release gate rejects mismatched evidence '+JSON.stringify(change),()=>{
 assert.throws(()=>successfulRun(payload(run(change)),options),/missing CI evidence/);
});

for(const [status,conclusion] of [['queued',null],['in_progress',null],['completed','failure'],['completed','cancelled'],['completed','skipped'],['completed','neutral']])test('CI release gate rejects '+status+'/'+conclusion+' even when an older run passed',()=>{
 assert.throws(()=>successfulRun(payload(run(),run({id:2,run_number:11,status,conclusion})),options),/not successful/);
});

test('CI release gate rejects missing, truncated or malformed results',()=>{
 for(const value of [null,{},payload(),{...payload(run()),total_count:101},payload(run({id:null})),payload(run({run_attempt:null}))])assert.throws(()=>successfulRun(value,options));
});

test('a failed rerun cannot be hidden behind a previous successful attempt',()=>{
 assert.throws(()=>successfulRun(payload(run(),run({run_attempt:2,conclusion:'failure'})),options),/not successful/);
});

test('invalid branch, commit or missing token stops before any GitHub request',async()=>{
 for(const override of [{GITHUB_REF:'refs/heads/feature'},{GITHUB_SHA:'main'},{GITHUB_REPOSITORY:'../other'},{GITHUB_TOKEN:''}]){
  let calls=0;await assert.rejects(checkReleaseCi({...env,...override},async()=>{calls++;return Response.json({});}));assert.equal(calls,0);
 }
});

test('CI release gate fails closed on HTTP, redirect, HTML and transport errors without printing secrets',async()=>{
 for(const fetcher of [async()=>new Response('fixture-secret',{status:403}),async()=>new Response('fixture-secret',{status:302,headers:{location:'https://untrusted.invalid'}}),async()=>new Response('<html>fixture-secret</html>'),async()=>{throw new Error('fixture-secret');}])await assert.rejects(checkReleaseCi(env,fetcher),error=>!error.message.includes('fixture-secret'));
});

test('a main branch movement during CI verification blocks deployment',async()=>{
 let branchReads=0;
 await assert.rejects(checkReleaseCi(env,async url=>{
  if(url.endsWith('/branches/main'))return Response.json({name:'main',commit:{sha:++branchReads===1?sha:'b'.repeat(40)}});
  return Response.json(payload(run({path:'.github/workflows/'+new URL(url).pathname.split('/').at(-2)})));
 }),/no longer the current main/);
});

test('staging deployment depends on a separate CI gate and rechecks before remote mutation',()=>{
 const source=readFileSync(new URL('../.github/workflows/account-staging-deploy.yml',import.meta.url),'utf8');
 assert.match(source,/require-ci:\s*\n\s+if: github.ref == 'refs\/heads\/main'/);
 assert.match(source,/deploy:\s*\n\s+needs: require-ci/);
 assert.equal((source.match(/run: node scripts\/check-release-ci.mjs/g)||[]).length,2);
 assert.ok(source.lastIndexOf('run: node scripts/check-release-ci.mjs')<source.indexOf('run: npm run deploy:account-staging'));
});
