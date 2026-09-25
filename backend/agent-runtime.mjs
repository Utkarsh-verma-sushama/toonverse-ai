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
export async function claimAgentRun(env,runId,owner){
 if(!env.DB)throw fail('DATABASE_NOT_CONNECTED');
 const cfg=agentConfig(env);if(!cfg.enabled)throw fail('AGENT_EXECUTION_DISABLED');
 const result=await env.DB.prepare("UPDATE agent_runs SET status='planning',updated_at=? WHERE id=? AND owner_id=? AND status='queued' AND julianday(updated_at)>=julianday('now','-5 minutes')")
  .bind(new Date().toISOString(),runId,owner).run();
 if(!result.meta?.changes)return null;
 const run=await env.DB.prepare('SELECT id,owner_id,status,objective,idempotency_key FROM agent_runs WHERE id=? AND owner_id=?').bind(runId,owner).first();
 if(!run||run.status!=='planning')throw fail('AGENT_CLAIM_STATE_INVALID',409);
 return run;
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
  await env.DB.prepare("UPDATE agent_runs SET status='failed',error_code='AGENT_RUNTIME_EXECUTION_NOT_CONNECTED',updated_at=? WHERE id=? AND owner_id=? AND status='planning'")
   .bind(new Date().toISOString(),runId,owner).run();
  return {claimed:true,reserved:true,executed:false};
 }catch(error){
  let cleanupError=null;
  if(reservation){try{await releaseChat(env,{sub:owner},reservation);}catch(releaseError){cleanupError=releaseError;}}
  // Never hide a reservation-cleanup failure: an uncertain reservation must stay
  // visible for reconciliation instead of being reported as an ordinary agent failure.
  const code=String(cleanupError?.code||error?.code||'AGENT_BUDGET_RESERVATION_FAILED').slice(0,128);
  await env.DB.prepare("UPDATE agent_runs SET status='failed',error_code=?,updated_at=? WHERE id=? AND owner_id=? AND status='planning'")
   .bind(code,new Date().toISOString(),runId,owner).run();
  if(cleanupError)throw cleanupError;
  throw error;
 }
}
