const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const id=()=>crypto.randomUUID();
const allowedTasks=new Set(["generate","edit","understand","ocr","transcribe","translate","summarize","math","safety"]);
function cors(request,env){const origin=request.headers.get("origin")||"";const allowed=String(env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);return allowed.includes(origin)?{"access-control-allow-origin":origin,"vary":"origin","access-control-allow-headers":"authorization,content-type,idempotency-key","access-control-allow-methods":"GET,POST,OPTIONS"}:{}}
function auth(request,env){const value=request.headers.get("authorization")||"";if(!env.AUTH_REQUIRED)return {sub:"development"};if(!value.startsWith("Bearer "))return null;return {sub:"verified-by-edge-auth"}}
async function body(request){try{return await request.json()}catch{return null}}
async function routeModel(input,env){
 const catalog=JSON.parse(env.MODEL_CATALOG_JSON||"[]");const task=String(input?.task||"");if(!allowedTasks.has(task))throw new Error("UNSUPPORTED_TASK");
 const modalities=new Set(input?.modalities||["text"]);const candidates=catalog.filter(m=>m.enabled!==false&&m.tasks?.includes(task)&&[...modalities].every(x=>m.modalities?.includes(x))&&(!input.region||input.region==="auto"||!m.regions||m.regions.includes(input.region))&&(!input.privacy||input.privacy==="standard"||m.privacy?.includes(input.privacy)));
 if(!candidates.length)throw new Error("NO_ROUTE");
 const score=m=>(input.quality==="high"?Number(m.quality||0)*4:Number(m.quality||0)*2)-Number(m.cost||0)*2-Number(m.latency||0)/10000+Number(m.health??1)*5;
 candidates.sort((a,b)=>score(b)-score(a));const primary=candidates[0],fallbacks=candidates.slice(1,1+Math.min(3,Number(input.fallbacks)||2));
 return {routeId:id(),provider:primary.provider,model:primary.model,fallbacks:fallbacks.map(x=>({provider:x.provider,model:x.model})),reason:"capability-policy-health-score",expiresAt:new Date(Date.now()+60000).toISOString(),provenance:{policyVersion:"1.0",candidateCount:candidates.length}};
}
async function createAgent(request,env,user){
 const input=await body(request);if(!input?.objective)return json({code:"INVALID_OBJECTIVE",message:"Objective is required."},400);
 const key=request.headers.get("idempotency-key");if(!key)return json({code:"IDEMPOTENCY_REQUIRED"},400);
 const runId=id(),now=new Date().toISOString(),run={id:runId,owner:user.sub,status:"queued",objective:String(input.objective).slice(0,4000),limits:input.limits||{},policy:input.policy||{},createdAt:now,updatedAt:now};
 if(env.DB)await env.DB.prepare("INSERT INTO agent_runs (id, owner_id, status, objective, payload_json, created_at, updated_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(runId,user.sub,"queued",run.objective,JSON.stringify(input),now,now,key).run();
 if(env.AGENT_QUEUE)await env.AGENT_QUEUE.send({runId,owner:user.sub});
 return json(run,202);
}
async function getRun(runId,env,user){if(!env.DB)return json({code:"DATABASE_NOT_CONNECTED"},503);const row=await env.DB.prepare("SELECT id,status,objective,created_at AS createdAt,updated_at AS updatedAt,error_code AS errorCode FROM agent_runs WHERE id=? AND owner_id=?").bind(runId,user.sub).first();return row?json(row):json({code:"NOT_FOUND"},404)}
async function mutateRun(runId,status,env,user){if(!env.DB)return json({code:"DATABASE_NOT_CONNECTED"},503);const now=new Date().toISOString();const out=await env.DB.prepare("UPDATE agent_runs SET status=?,updated_at=? WHERE id=? AND owner_id=? AND status NOT IN ('completed','failed','cancelled','expired')").bind(status,now,runId,user.sub).run();return json({ok:true,id:runId,status,changed:out.meta?.changes||0},202)}
export default {async fetch(request,env){
 const url=new URL(request.url),headers=cors(request,env);if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(url.pathname==="/v1/health")return json({ok:true,version:"2.0.0",services:{database:Boolean(env.DB),queue:Boolean(env.AGENT_QUEUE),storage:Boolean(env.MEDIA),routing:Boolean(env.MODEL_CATALOG_JSON)}},200,headers);
 const user=auth(request,env);if(!user)return json({code:"UNAUTHORIZED"},401,headers);
 try{
  if(url.pathname==="/v1/ai/routes"&&request.method==="POST")return json(await routeModel(await body(request),env),200,headers);
  if(url.pathname==="/v1/agents/runs"&&request.method==="POST")return createAgent(request,env,user);
  let m=url.pathname.match(/^\/v1\/agents\/runs\/([^/]+)$/);if(m&&request.method==="GET")return getRun(decodeURIComponent(m[1]),env,user);
  m=url.pathname.match(/^\/v1\/agents\/runs\/([^/]+)\/cancel$/);if(m&&request.method==="POST")return mutateRun(decodeURIComponent(m[1]),"cancelled",env,user);
  m=url.pathname.match(/^\/v1\/agents\/runs\/([^/]+)\/approvals\/([^/]+)$/);if(m&&request.method==="POST"){const input=await body(request);if(!["approve","deny"].includes(input?.decision))return json({code:"INVALID_DECISION"},400,headers);if(env.DB)await env.DB.prepare("UPDATE agent_approvals SET decision=?,reason=?,decided_at=? WHERE id=? AND run_id=? AND owner_id=? AND decision='pending'").bind(input.decision,String(input.reason||"").slice(0,500),new Date().toISOString(),decodeURIComponent(m[2]),decodeURIComponent(m[1]),user.sub).run();return json({ok:true,decision:input.decision},200,headers)}
  return json({code:"NOT_FOUND"},404,headers);
 }catch(error){return json({code:error.message==="NO_ROUTE"?"NO_ROUTE":"INTERNAL_ERROR",message:error.message==="NO_ROUTE"?"No policy-compliant model is currently available.":"Request could not be completed."},error.message==="NO_ROUTE"?503:500,headers)}
}};