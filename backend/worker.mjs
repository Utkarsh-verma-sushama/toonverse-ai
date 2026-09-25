import {prepareAgentExecution} from './agent-runtime.mjs';
import { IdentityError } from "./firebase-auth.mjs";
import { AttestationError, verifyAppCheckRequest } from "./app-check.mjs";
import { ReplayError, consumeReplayNonce } from "./replay-guard.mjs";
import { BillingError, getChatReceipt, expireUndispatched } from "./chat-billing.mjs";
import { executeChat } from "./chat-execution.mjs";
import { accountRoute } from "./account-api.mjs";
import { authenticateAccountRequest, cleanupAccounts } from "./account-sessions.mjs";
import { AccountError } from "./account-common.mjs";
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const id=()=>crypto.randomUUID();
const allowedTasks=new Set(["generate","edit","understand","ocr","transcribe","translate","summarize","math","safety"]);
function cors(request,env){
 const origin=request.headers.get("origin"),headers={vary:"Origin"};
 const allowed=String(env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(x=>x&&x!=="null"&&x!=="*");
 if(origin&&allowed.includes(origin))Object.assign(headers,{"access-control-allow-origin":origin,"access-control-allow-credentials":"true","access-control-allow-headers":"authorization,content-type,idempotency-key,x-uvenaro-device,x-uvenaro-csrf,x-firebase-appcheck,x-uvenaro-nonce","access-control-allow-methods":"GET,POST,DELETE,OPTIONS","access-control-max-age":"600"});
 return headers;
}
async function body(request) {
 if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new RequestError("JSON_REQUIRED",415);
 const declared = request.headers.get("content-length");
 if (declared && (!/^\d+$/.test(declared) || Number(declared)>65536)) throw new RequestError("REQUEST_TOO_LARGE",413);
 if (!request.body) throw new RequestError("INVALID_JSON",400);
 const reader=request.body.getReader(),chunks=[];let size=0;
 try { while(true) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new RequestError("REQUEST_TOO_LARGE",413);}chunks.push(value); } }
 finally {reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try {const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value;}
 catch {throw new RequestError("INVALID_JSON",400);}
}
class RequestError extends Error {constructor(code,status){super(code);this.code=code;this.status=status;}}
async function routeModel(input,env){
 const catalog=JSON.parse(env.MODEL_CATALOG_JSON||"[]");const task=String(input?.task||"");if(!allowedTasks.has(task))throw new Error("UNSUPPORTED_TASK");
 const modalities=new Set(input?.modalities||["text"]);const candidates=catalog.filter(m=>m.enabled!==false&&m.tasks?.includes(task)&&[...modalities].every(x=>m.modalities?.includes(x))&&(!input.region||input.region==="auto"||!m.regions||m.regions.includes(input.region))&&(!input.privacy||input.privacy==="standard"||m.privacy?.includes(input.privacy)));
 if(!candidates.length)throw new Error("NO_ROUTE");
 const score=m=>(input.quality==="high"?Number(m.quality||0)*4:Number(m.quality||0)*2)-Number(m.cost||0)*2-Number(m.latency||0)/10000+Number(m.health??1)*5;
 candidates.sort((a,b)=>score(b)-score(a));const primary=candidates[0],fallbacks=candidates.slice(1,1+Math.min(3,Number(input.fallbacks)||2));
 return {routeId:id(),provider:primary.provider,model:primary.model,fallbacks:fallbacks.map(x=>({provider:x.provider,model:x.model})),reason:"capability-policy-health-score",expiresAt:new Date(Date.now()+60000).toISOString(),provenance:{policyVersion:"1.0",candidateCount:candidates.length}};
}
async function createAgent(request,env,user){
 if(!env.DB||!env.AGENT_QUEUE)return json({code:"AGENT_BACKEND_NOT_CONNECTED"},503);
 const input=await body(request);if(typeof input?.objective!=="string"||!input.objective.trim()||input.objective.length>4000)return json({code:"INVALID_OBJECTIVE",message:"Objective is required."},400);
 const key=request.headers.get("idempotency-key");if(!key||!/^[A-Za-z0-9_-]{1,128}$/.test(key))return json({code:"IDEMPOTENCY_REQUIRED"},400);
 if(input.limits!==undefined||input.policy!==undefined)return json({code:"SERVER_POLICY_REQUIRED"},400);
 const existing=await env.DB.prepare("SELECT id,status,objective,created_at AS createdAt,updated_at AS updatedAt FROM agent_runs WHERE owner_id=? AND idempotency_key=?").bind(user.sub,key).first();
 if(existing){if(existing.objective!==input.objective.trim())return json({code:"IDEMPOTENCY_CONFLICT"},409);return json(existing,200);}
 const active=await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE owner_id=? AND status IN ('queued','planning','running','awaiting_approval')").bind(user.sub).first();
 if(Number(active?.n||0)>=2)return json({code:"AGENT_CONCURRENCY_LIMIT_REACHED"},429);
 const runId=id(),now=new Date().toISOString(),run={id:runId,owner:user.sub,status:"queued",objective:input.objective.trim(),createdAt:now,updatedAt:now};
 const payload={objective:run.objective};
 try{await env.DB.prepare("INSERT INTO agent_runs (id, owner_id, status, objective, payload_json, created_at, updated_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(runId,user.sub,"queued",run.objective,JSON.stringify(payload),now,now,key).run();}
 catch(error){
  if(String(error?.message||"").includes("AGENT_CONCURRENCY_LIMIT_REACHED"))return json({code:"AGENT_CONCURRENCY_LIMIT_REACHED"},429);
  const raced=await env.DB.prepare("SELECT id,status,objective,created_at AS createdAt,updated_at AS updatedAt FROM agent_runs WHERE owner_id=? AND idempotency_key=?").bind(user.sub,key).first();
  if(raced){if(raced.objective!==run.objective)return json({code:"IDEMPOTENCY_CONFLICT"},409);return json(raced,200);}
  throw error;
 }
 try{await env.AGENT_QUEUE.send({runId,owner:user.sub});}
 catch{
  const terminal=await env.DB.prepare("UPDATE agent_runs SET status='failed',error_code='QUEUE_DISPATCH_FAILED',updated_at=? WHERE id=? AND owner_id=? AND status='queued'").bind(new Date().toISOString(),runId,user.sub).run();
  if(!terminal.meta?.changes){
   const current=await env.DB.prepare("SELECT status FROM agent_runs WHERE id=? AND owner_id=?").bind(runId,user.sub).first();
   // Cancellation may legitimately win while queue dispatch is failing. Any run
   // still queued here would leak active capacity without executable work.
   if(current?.status==='queued')return json({code:"AGENT_QUEUE_STATE_LOST"},503);
  }
  return json({code:"AGENT_QUEUE_UNAVAILABLE"},503);
 }
 return json(run,202);
}
async function getRun(runId,env,user){
 if(!env.DB)return json({code:"DATABASE_NOT_CONNECTED"},503);
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(runId))return json({code:"INVALID_RUN_REFERENCE"},400);
 const row=await env.DB.prepare("SELECT id,status,objective,created_at AS createdAt,updated_at AS updatedAt,error_code AS errorCode FROM agent_runs WHERE id=? AND owner_id=?").bind(runId,user.sub).first();
 return row?json(row):json({code:"NOT_FOUND"},404);
}
async function mutateRun(runId,status,env,user){
 if(!env.DB)return json({code:"DATABASE_NOT_CONNECTED"},503);
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(runId))return json({code:"INVALID_RUN_REFERENCE"},400);
 if(status!=="cancelled")return json({code:"INVALID_RUN_TRANSITION"},400);
 const row=await env.DB.prepare("SELECT status FROM agent_runs WHERE id=? AND owner_id=?").bind(runId,user.sub).first();
 if(!row)return json({code:"NOT_FOUND"},404);
 if(!["queued","planning","running","awaiting_approval"].includes(row.status))return json({code:"RUN_NOT_ACTIVE"},409);
 const out=await env.DB.prepare("UPDATE agent_runs SET status='cancelled',updated_at=? WHERE id=? AND owner_id=? AND status IN ('queued','planning','running','awaiting_approval')").bind(new Date().toISOString(),runId,user.sub).run();
 return out.meta?.changes?json({ok:true,id:runId,status},202):json({code:"RUN_NOT_ACTIVE"},409);
}
async function decideApproval(runId,approvalId,input,env,user){
 if(!env.DB)return json({code:"DATABASE_NOT_CONNECTED"},503);
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(runId)||!/^[A-Za-z0-9_-]{1,128}$/.test(approvalId))return json({code:"INVALID_APPROVAL_REFERENCE"},400);
 if(!["approve","deny"].includes(input?.decision)||input.reason!==undefined&&(typeof input.reason!=="string"||input.reason.length>500))return json({code:"INVALID_DECISION"},400);
 const row=await env.DB.prepare("SELECT a.decision,a.expires_at AS expiresAt,r.status AS runStatus FROM agent_approvals a JOIN agent_runs r ON r.id=a.run_id AND r.owner_id=a.owner_id WHERE a.id=? AND a.run_id=? AND a.owner_id=?").bind(approvalId,runId,user.sub).first();
 if(!row)return json({code:"NOT_FOUND"},404);
 if(row.decision!=="pending"||row.runStatus!=="awaiting_approval"||!Number.isFinite(Date.parse(row.expiresAt))||Date.parse(row.expiresAt)<=Date.now())return json({code:"APPROVAL_NOT_PENDING"},409);
 const out=await env.DB.prepare("UPDATE agent_approvals SET decision=?,reason=?,decided_at=? WHERE id=? AND run_id=? AND owner_id=? AND decision='pending' AND julianday(expires_at) IS NOT NULL AND julianday(expires_at)>julianday('now') AND EXISTS (SELECT 1 FROM agent_runs WHERE id=? AND owner_id=? AND status='awaiting_approval')").bind(input.decision,input.reason||"",new Date().toISOString(),approvalId,runId,user.sub,runId,user.sub).run();
 return out.meta?.changes?json({ok:true,decision:input.decision},200):json({code:"APPROVAL_NOT_PENDING"},409);
}
export default {async fetch(request,env={}){
 const url=new URL(request.url),headers=cors(request,env);
 const finish=response=>{const merged=new Headers(response.headers);for(const [key,value] of Object.entries(headers))merged.set(key,value);merged.set("x-content-type-options","nosniff");return new Response(response.body,{status:response.status,headers:merged});};
 try{
  if(request.headers.has("origin")&&!headers["access-control-allow-origin"])return finish(json({code:"ORIGIN_NOT_ALLOWED"},403));
  if(request.method==="OPTIONS")return finish(new Response(null,{status:204}));
  if(url.pathname==="/v1/health"&&request.method==="GET")return finish(json({ok:true,version:"2.0.0"}));
  const account=await accountRoute(request,env,body);if(account)return finish(account);
  // Firebase credentials stay server-side. Raw Firebase JWTs cannot bypass logout.
  if(!/^Bearer uv1\.[A-Za-z0-9_-]{43}$/.test(request.headers.get('authorization')||''))return finish(json({code:'UNAUTHORIZED'},401));
  if(url.pathname==='/v1/chat/responses'&&env.CHAT_EXECUTION_ENABLED!=='true')return finish(json({code:'CHAT_EXECUTION_DISABLED'},503));
  if(url.pathname.startsWith('/v1/agents/')&&env.AGENT_EXECUTION_ENABLED!=='true')return finish(json({code:'AGENT_EXECUTION_DISABLED'},503));
  if(url.pathname==='/v1/ai/routes'&&env.MODEL_ROUTING_ENABLED!=='true')return finish(json({code:'MODEL_ROUTING_DISABLED'},503));
  const user=await authenticateAccountRequest(request,env);
  // Authenticate the account first, then require a cryptographically attested
  // Uvenaro client before any protected routing, AI, agent or billing work.
  await verifyAppCheckRequest(request,env);
  const profile=await env.DB.prepare('SELECT status FROM account_profiles WHERE owner_id=?').bind(user.sub).first();
  if(profile?.status!=='active')return finish(json({code:'ACCOUNT_RESTRICTED'},403));
  if(!user.emailVerified&&!url.pathname.startsWith('/v1/chat/requests/'))return finish(json({code:'EMAIL_VERIFICATION_REQUIRED'},403));
  if(url.pathname==="/v1/ai/routes"&&request.method==="POST"){
   if(env.MODEL_ROUTING_ENABLED!=="true")return finish(json({code:"MODEL_ROUTING_DISABLED"},503));
   return finish(json(await routeModel(await body(request),env)));
  }
  if(url.pathname==="/v1/chat/responses"&&request.method==="POST"){await consumeReplayNonce(env,user,request,"chat");return finish(await executeChat(request,env,user,body));}
  const receiptPath=url.pathname.match(/^\/v1\/chat\/requests\/([A-Za-z0-9_-]{1,128})$/);
  if(receiptPath&&request.method==="GET")return finish(json(await getChatReceipt(env,user,receiptPath[1])));
  if(url.pathname.startsWith("/v1/agents/")&&env.AGENT_EXECUTION_ENABLED!=="true")return finish(json({code:"AGENT_EXECUTION_DISABLED"},503));
  if(url.pathname==="/v1/agents/runs"&&request.method==="POST"){await consumeReplayNonce(env,user,request,"agent");return finish(await createAgent(request,env,user));}
  let m=url.pathname.match(/^\/v1\/agents\/runs\/([^/]+)$/);if(m&&request.method==="GET")return finish(await getRun(decodeURIComponent(m[1]),env,user));
  m=url.pathname.match(/^\/v1\/agents\/runs\/([^/]+)\/cancel$/);if(m&&request.method==="POST")return finish(await mutateRun(decodeURIComponent(m[1]),"cancelled",env,user));
  m=url.pathname.match(/^\/v1\/agents\/runs\/([^/]+)\/approvals\/([^/]+)$/);if(m&&request.method==="POST")return finish(await decideApproval(decodeURIComponent(m[1]),decodeURIComponent(m[2]),await body(request),env,user));
  return finish(json({code:"NOT_FOUND"},404));
 }catch(error){
  if(error instanceof BillingError)return finish(json({code:error.code,...(error.receipt?{reservation:error.receipt}:{})},error.status));
  if(error instanceof AccountError)return finish(json({code:error.code},error.status));
  if(error instanceof IdentityError||error instanceof AttestationError||error instanceof ReplayError||error instanceof RequestError)return finish(json({code:error.code},error.status));
  if(error instanceof URIError)return finish(json({code:"INVALID_PATH"},400));
  if(error.message==="NO_ROUTE")return finish(json({code:"NO_ROUTE",message:"No policy-compliant model is currently available."},503));
  return finish(json({code:"INTERNAL_ERROR",message:"Request could not be completed."},500));
 }
},async queue(batch,env){
 if(!env.DB){for(const message of batch.messages)message.retry();return;}
 for(const message of batch.messages){
  const runId=message.body?.runId,owner=message.body?.owner;
  if(typeof runId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(runId)||typeof owner!=="string"||owner.length<1||owner.length>128){message.ack();continue;}
  try{
   const run=await env.DB.prepare("SELECT status,owner_id AS owner FROM agent_runs WHERE id=?").bind(runId).first();
   // Only a queued run may cross the execution boundary. Duplicate deliveries for
   // planning/running/approval states are acknowledged here without re-claiming or billing.
   if(!run||run.owner!==owner||run.status!=="queued"){message.ack();continue;}
   const prepared=await prepareAgentExecution(env,runId,owner);
   // A duplicate delivery, terminal run or already-claimed run performs no work.
   // The metered runtime owns the atomic queued->planning claim and budget boundary.
   if(!prepared){message.ack();continue;}
   message.ack();
  }catch{message.retry();}
 }
},async scheduled(event,env,context){context.waitUntil(Promise.all([expireUndispatched(env),cleanupAccounts(env),cleanupReplayNonces(env)]));}};
