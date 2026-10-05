import {agentConfig} from './agent-runtime.mjs';
const required=['AGENT_PROVIDER','AGENT_MODEL','AGENT_PROVIDER_URL','AGENT_PROVIDER_ALLOWED_ORIGIN','AGENT_PROVIDER_PROTOCOL','AGENT_PROVIDER_API_KEY'];
const productionRequired=['AGENT_PROVIDER_GATEWAY_AUDITED','AGENT_PROVIDER_APPROVED_ORIGIN'];
const CONFIRMATION='UVENARO_ENABLE_PAID_AGENT';
const blocker=(code,detail='')=>detail?{code,detail}:{code};
// Read-only preflight: no provider calls, mutations, reservations, or secret output.
export async function inspectAgentActivation(env={}){
 const blockers=[];
 if(env.AGENT_EXECUTION_ENABLED!=='true')blockers.push(blocker('AGENT_EXECUTION_DISABLED'));
 if(env.AGENT_PROVIDER_DISPATCH_ENABLED!=='true')blockers.push(blocker('AGENT_PROVIDER_DISPATCH_DISABLED'));
 if(env.ENVIRONMENT==='production'&&env.AGENT_PAID_EXECUTION_CONFIRMATION!==CONFIRMATION)blockers.push(blocker('AGENT_PAID_EXECUTION_CONFIRMATION_REQUIRED'));
 for(const name of required)if(!String(env[name]||'').trim())blockers.push(blocker(name+'_MISSING'));
 if(env.ENVIRONMENT==='production')for(const name of productionRequired)if(!String(env[name]||'').trim())blockers.push(blocker(name+'_MISSING'));
 let cfg=null;try{cfg=agentConfig(env);if(!cfg.dispatchEnabled)blockers.push(blocker('AGENT_PROVIDER_DISPATCH_DISABLED'));}catch(error){blockers.push(blocker(String(error?.code||'AGENT_CONFIGURATION_INVALID')));}
 if(!env.DB)blockers.push(blocker('DATABASE_NOT_CONNECTED'));
 let policy=null,price=null,open=0;
 if(env.DB){
  try{policy=await env.DB.prepare("SELECT enabled,global_daily_cost_microusd AS globalDailyCost FROM chat_billing_policy WHERE id='chat'").first();}catch{blockers.push(blocker('BILLING_SCHEMA_NOT_READY'));}
  if(cfg?.dispatchEnabled)try{price=await env.DB.prepare("SELECT id FROM provider_price_snapshots WHERE provider=? AND model=? AND retired_at IS NULL AND julianday(effective_at)<=julianday('now') AND julianday(valid_until)>julianday('now') ORDER BY julianday(effective_at) DESC LIMIT 1").bind(cfg.provider,cfg.model).first();}catch{blockers.push(blocker('PRICE_SCHEMA_NOT_READY'));}
  try{const row=await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE status='reserved'").first();open=Number(row?.n||0);}catch{blockers.push(blocker('RESERVATION_SCHEMA_NOT_READY'));}
 }
 if(policy?.enabled!==1)blockers.push(blocker('BILLING_POLICY_DISABLED'));
 if(policy&&(!Number.isSafeInteger(policy.globalDailyCost)||policy.globalDailyCost<1))blockers.push(blocker('GLOBAL_BUDGET_INVALID'));
 const envBudget=Number(env.AGENT_GLOBAL_DAILY_COST_MICROUSD);
 if(policy&&Number.isSafeInteger(envBudget)&&envBudget>policy.globalDailyCost)blockers.push(blocker('ENV_BUDGET_EXCEEDS_DB_BUDGET'));
 if(cfg?.dispatchEnabled&&!price)blockers.push(blocker('CURRENT_PRICE_SNAPSHOT_REQUIRED'));
 if(open>0)blockers.push(blocker('UNRESOLVED_RESERVATIONS',String(open)));
 return Object.freeze({eligible:blockers.length===0,safeOff:env.AGENT_EXECUTION_ENABLED!=='true'||env.AGENT_PROVIDER_DISPATCH_ENABLED!=='true',blockers,checks:Object.freeze({config:Boolean(cfg?.dispatchEnabled),billingPolicy:Boolean(policy?.enabled===1),currentPrice:Boolean(price),unresolvedReservations:open})});
}
