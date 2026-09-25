import {reserveChat,releaseChat} from './chat-billing.mjs';

const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
const integer=(env,name,fallback,min,max)=>{
 const raw=env[name]===undefined?String(fallback):String(env[name]);
 if(!/^\d+$/.test(raw)){throw fail('AGENT_CONFIGURATION_INVALID');}
 const value=Number(raw);if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('AGENT_CONFIGURATION_INVALID');
 return value;
};
export function agentConfig(env){
 if(env.AGENT_EXECUTION_ENABLED!=='true')return {enabled:false};
 const provider=String(env.AGENT_PROVIDER||''),model=String(env.AGENT_MODEL||'');
 if(!/^[A-Za-z0-9._-]{1,64}$/.test(provider)||!/^[A-Za-z0-9._:-]{1,128}$/.test(model))throw fail('AGENT_PROVIDER_NOT_CONFIGURED');
 return {enabled:true,maxSteps:integer(env,'AGENT_MAX_STEPS',8,1,32),maxRuntimeMs:integer(env,'AGENT_MAX_RUNTIME_MS',60000,1000,300000),
  maxInputTokens:integer(env,'AGENT_MAX_INPUT_TOKENS',4000,1,12000),maxOutputTokens:integer(env,'AGENT_MAX_OUTPUT_TOKENS',1000,1,8000),
  globalCeiling:integer(env,'AGENT_GLOBAL_DAILY_COST_MICROUSD',0,1,1e12),provider,model};
}
const SAFE_AGENT_TOOLS=new Set(['read_project','search_project','draft_content','analyze_asset']);
const APPROVAL_AGENT_TOOLS=new Set(['write_project','share_project','publish_project','delete_project','external_send']);
export function authorizeAgentTool(toolName,{approvalGranted=false}={}){
 const name=String(toolName||'');
 if(!/^[a-z][a-z0-9_]{0,63}$/.test(name))throw fail('AGENT_TOOL_INVALID',400);
 if(SAFE_AGENT_TOOLS.has(name))return {tool:name,requiresApproval:false};
 if(APPROVAL_AGENT_TOOLS.has(name)){
  if(!approvalGranted)throw fail('AGENT_TOOL_APPROVAL_REQUIRED',409);
  return {tool:name,requiresApproval:true};
 }
 throw fail('AGENT_TOOL_NOT_ALLOWED',403);
}
export async function authorizeAgentToolForRun(env,{runId,owner,toolName,approvalId=null,stepId=null}){
 if(!env.DB)throw fail('DATABASE_NOT_CONNECTED');
 const name=String(toolName||'');
 if(!APPROVAL_AGENT_TOOLS.has(name))return authorizeAgentTool(name);
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(runId||''))||!/^[A-Za-z0-9_-]{1,128}$/.test(String(owner||''))||!/^[A-Za-z0-9_-]{1,128}$/.test(String(approvalId||'')))throw fail('AGENT_APPROVAL_REFERENCE_INVALID',400);
 const row=await env.DB.prepare("SELECT a.decision,a.action_type,a.expires_at AS expiresAt,a.decided_at AS decidedAt,r.status AS runStatus FROM agent_approvals a JOIN agent_runs r ON r.id=a.run_id AND r.owner_id=a.owner_id WHERE a.id=? AND a.run_id=? AND a.owner_id=?").bind(approvalId,runId,owner).first();
 const now=Date.now(),expiresAt=Date.parse(row?.expiresAt),decidedAt=Date.parse(row?.decidedAt);
 if(!row||row.decision!=='approve'||row.runStatus!=='awaiting_approval'||!Number.isFinite(expiresAt)||expiresAt<=now||!Number.isFinite(decidedAt)||decidedAt>now||decidedAt>=expiresAt)throw fail('AGENT_TOOL_APPROVAL_REQUIRED',409);
 if(String(row.action_type)!==name)throw fail('AGENT_TOOL_APPROVAL_MISMATCH',409);
 if(stepId!==null){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(stepId)))throw fail('AGENT_STEP_REFERENCE_INVALID',400);
  const step=await env.DB.prepare("SELECT s.tool_name AS toolName,s.status,r.owner_id AS ownerId FROM agent_steps s JOIN agent_runs r ON r.id=s.run_id WHERE s.id=? AND s.run_id=?").bind(stepId,runId).first();
  if(!step||step.ownerId!==owner||step.toolName!==name||!['pending','awaiting_approval'].includes(String(step.status)))throw fail('AGENT_TOOL_STEP_MISMATCH',409);
 }
 return authorizeAgentTool(name,{approvalGranted:true});
}
export async function claimAgentRun(env,runId,owner){
 if(!env.DB)throw fail('DATABASE_NOT_CONNECTED');
 const cfg=agentConfig(env);if(!cfg.enabled)throw fail('AGENT_EXECUTION_DISABLED');
 const result=await env.DB.prepare("UPDATE agent_runs SET status='planning',updated_at=? WHERE id=? AND owner_id=? AND status='queued' AND julianday(updated_at)>=julianday('now','-5 minutes')")
  .bind(new Date().toISOString(),runId,owner).run();
 if(!result.meta?.changes){
  // A stale or malformed queued timestamp must not occupy an active-run slot forever.
  // Expire it atomically; a concurrent worker that already moved it out of queued is untouched.
  const expired=await env.DB.prepare("UPDATE agent_runs SET status='expired',error_code='AGENT_QUEUE_STALE',updated_at=? WHERE id=? AND owner_id=? AND status='queued' AND (updated_at IS NULL OR julianday(updated_at) IS NULL OR julianday(updated_at)<julianday('now','-5 minutes'))")
   .bind(new Date().toISOString(),runId,owner).run();
  if(!expired.meta?.changes){
   const current=await env.DB.prepare("SELECT status FROM agent_runs WHERE id=? AND owner_id=?").bind(runId,owner).first();
   // A concurrent worker/cancellation may legitimately move the run first. A run
   // that is still queued here is an ambiguous lost expiry and must fail closed.
   if(current?.status==='queued')throw fail('AGENT_EXPIRY_STATE_LOST',409);
  }
  return null;
 }
 const run=await env.DB.prepare('SELECT id,owner_id,status,objective,idempotency_key FROM agent_runs WHERE id=? AND owner_id=?').bind(runId,owner).first();
 if(!run||run.status!=='planning')throw fail('AGENT_CLAIM_STATE_INVALID',409);
 if(typeof run.objective!=='string'||!run.objective.trim()||run.objective.length>4000||
    typeof run.idempotency_key!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(run.idempotency_key)){
   const terminal=await env.DB.prepare("UPDATE agent_runs SET status='failed',error_code='AGENT_PERSISTED_INPUT_INVALID',updated_at=? WHERE id=? AND owner_id=? AND status='planning'")
    .bind(new Date().toISOString(),runId,owner).run();
   // Cancellation may win after the claim. Otherwise a lost quarantine transition
   // is ambiguous and must not be treated as a successfully quarantined run.
   if(!terminal.meta?.changes){
    const current=await env.DB.prepare("SELECT status FROM agent_runs WHERE id=? AND owner_id=?").bind(runId,owner).first();
    if(current?.status!=='cancelled')throw fail('AGENT_QUARANTINE_STATE_LOST',409);
   }
   throw fail('AGENT_PERSISTED_INPUT_INVALID',409);
  }
 return {...run,objective:run.objective.trim()};
}
export async function reserveAgentBudget(env,run,cfg=agentConfig(env)){
 if(!run||run.status!=='planning')throw fail('AGENT_RUN_NOT_CLAIMED',409);
 if(!cfg.provider||!cfg.model||!cfg.globalCeiling)throw fail('AGENT_PROVIDER_NOT_CONFIGURED');
 const key=`agent_${run.id}`;
 const reservation=await reserveChat(env,{sub:run.owner_id,verified:true},key,[{role:'user',content:run.objective}],{
  provider:cfg.provider,model:cfg.model,maxInputTokens:cfg.maxInputTokens,maxOutputTokens:cfg.maxOutputTokens,globalCeiling:cfg.globalCeiling});
 return reservation;
}
export async function prepareAgentExecution(env,runId,owner){
 const cfg=agentConfig(env),run=await claimAgentRun(env,runId,owner);if(!run)return null;
 let reservation;
 try{
  reservation=await reserveAgentBudget(env,run,cfg);
  // No provider/tool dispatch has happened yet. Keep provider_state=not_started so
  // the reservation can be safely released without creating a reconciliation hold.
  // beginDispatch belongs immediately before a real provider request.
  await releaseChat(env,{sub:owner},reservation);
  // Release is final. Do not let a later terminal-state error re-enter cleanup
  // with a stale reservation handle and attempt the billing release twice.
  reservation=null;
  const terminal=await env.DB.prepare("UPDATE agent_runs SET status='failed',error_code='AGENT_RUNTIME_EXECUTION_NOT_CONNECTED',updated_at=? WHERE id=? AND owner_id=? AND status='planning'")
   .bind(new Date().toISOString(),runId,owner).run();
  // A concurrent cancellation may legitimately win after budget release. Any other
  // lost transition is ambiguous and must not be reported as a successful preparation.
  if(!terminal.meta?.changes){
   const current=await env.DB.prepare("SELECT status FROM agent_runs WHERE id=? AND owner_id=?").bind(runId,owner).first();
   if(current?.status==='cancelled')return {claimed:true,reserved:true,executed:false,cancelled:true};
   throw fail('AGENT_TERMINAL_STATE_LOST',409);
  }
  return {claimed:true,reserved:true,executed:false};
 }catch(error){
  let cleanupError=null;
  if(reservation){try{await releaseChat(env,{sub:owner},reservation);}catch(releaseError){cleanupError=releaseError;}}
  // Never hide a reservation-cleanup failure: an uncertain reservation must stay
  // visible for reconciliation instead of being reported as an ordinary agent failure.
  const code=String(cleanupError?.code||error?.code||'AGENT_BUDGET_RESERVATION_FAILED').slice(0,128);
  const terminal=await env.DB.prepare("UPDATE agent_runs SET status='failed',error_code=?,updated_at=? WHERE id=? AND owner_id=? AND status='planning'")
   .bind(code,new Date().toISOString(),runId,owner).run();
  // Cancellation may legitimately win while cleanup is in flight. Any other lost
  // failure transition is ambiguous and must remain fail-closed.
  if(!terminal.meta?.changes){
   const current=await env.DB.prepare("SELECT status FROM agent_runs WHERE id=? AND owner_id=?").bind(runId,owner).first();
   if(current?.status!=='cancelled')throw fail('AGENT_FAILURE_STATE_LOST',409);
  }
  if(cleanupError)throw cleanupError;
  throw error;
 }
}
