import {pathToFileURL} from 'node:url';

export const requiredWorkflows=Object.freeze(['security-gate.yml','cloud-runtime-validate.yml','native-build.yml']);
const fail=message=>{throw new Error('Release blocked: '+message);};

export function successfulRun(payload,{repository,sha,workflow}){
 if(!Number.isSafeInteger(payload?.total_count)||!Array.isArray(payload.workflow_runs)||payload.total_count!==payload.workflow_runs.length)fail('incomplete CI evidence for '+workflow);
 const runs=payload.workflow_runs.filter(run=>run.head_sha===sha&&run.head_branch==='main'&&
  run.repository?.full_name===repository&&run.head_repository?.full_name===repository&&
  ['push','workflow_dispatch'].includes(run.event)&&run.path?.split('@')[0]==='.github/workflows/'+workflow);
 if(!runs.length)fail('missing CI evidence for '+workflow);
 if(runs.some(run=>!Number.isSafeInteger(run.id)||!Number.isSafeInteger(run.run_number)||!Number.isSafeInteger(run.run_attempt)))fail('invalid CI evidence for '+workflow);
 const latest=runs.sort((a,b)=>b.run_number-a.run_number||b.run_attempt-a.run_attempt)[0];
 if(latest.status!=='completed'||latest.conclusion!=='success')fail(workflow+' is not successful for the selected commit');
 return {workflow,runId:latest.id,attempt:latest.run_attempt};
}

export async function checkReleaseCi(env=process.env,fetcher=fetch){
 const repository=env.GITHUB_REPOSITORY,sha=env.GITHUB_SHA;
 if(env.GITHUB_REF!=='refs/heads/main'||!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(repository||'')||!/^[a-f0-9]{40}$/.test(sha||'')||!env.GITHUB_TOKEN)fail('main branch, exact commit and read-only GitHub access are required');
 async function get(path){
  let response;
  try{response=await fetcher('https://api.github.com/repos/'+repository+path,{
   headers:{accept:'application/vnd.github+json',authorization:'Bearer '+env.GITHUB_TOKEN,'x-github-api-version':'2026-03-10'},
   redirect:'error',signal:AbortSignal.timeout(10000)
  });}catch{fail('GitHub verification unavailable');}
  if(!response.ok||response.redirected)fail('GitHub verification returned an unsuccessful response');
  // Bound both provider data and diagnostics; never print tokens or API bodies.
  const reader=response.body?.getReader();if(!reader)fail('empty GitHub verification response');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();fail('GitHub verification response is too large');}chunks.push(value);}}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('invalid GitHub verification response');}
 }
 async function currentMain(){const branch=await get('/branches/main');if(branch.name!=='main'||branch.commit?.sha!==sha)fail('selected commit is no longer the current main branch');}
 await currentMain();
 const checks=[];
 for(const workflow of requiredWorkflows){
  const payload=await get('/actions/workflows/'+workflow+'/runs?head_sha='+sha+'&branch=main&per_page=100');
  checks.push(successfulRun(payload,{repository,sha,workflow}));
 }
 await currentMain();
 return {sha,checks};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await checkReleaseCi()));}
 catch(error){console.error(error.message?.startsWith('Release blocked:')?error.message:'Release blocked: CI verification unavailable');process.exitCode=1;}
}
