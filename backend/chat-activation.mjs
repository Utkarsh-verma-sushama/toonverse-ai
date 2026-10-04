import {chatConfig} from './chat-execution.mjs';

// Read-only activation audit. This module never changes a flag, calls a provider
// or exposes a secret. It is deliberately separate from request execution so an
// operator can review every gate before enabling paid chat.
const required = ['DB','CHAT_PROVIDER','CHAT_MODEL','CHAT_PROVIDER_URL','CHAT_PROVIDER_ALLOWED_ORIGIN','CHAT_PROVIDER_PROTOCOL','CHAT_PROVIDER_API_KEY'];
const productionRequired = ['CHAT_PROVIDER_GATEWAY_AUDITED','CHAT_PROVIDER_APPROVED_ORIGIN'];
const PRODUCTION_CONFIRMATION = 'UVENARO_ENABLE_PAID_CHAT';

function blocker(code, detail='') { return detail ? {code,detail} : {code}; }

export async function inspectChatActivation(env={}) {
  const blockers=[];
  if (env.CHAT_EXECUTION_ENABLED !== 'true') blockers.push(blocker('EXECUTION_DISABLED'));
  // Production paid execution needs an independent, explicit confirmation. This
  // prevents a single mis-set execution flag from making provider spend eligible.
  if (env.ENVIRONMENT === 'production' && env.CHAT_PAID_EXECUTION_CONFIRMATION !== PRODUCTION_CONFIRMATION)
    blockers.push(blocker('PAID_EXECUTION_CONFIRMATION_REQUIRED'));
  for (const name of required) {
    if (name === 'DB') continue;
    if (!String(env[name] || '').trim()) blockers.push(blocker(`${name}_MISSING`));
  }
  // Surface production trust-boundary omissions explicitly in the read-only audit,
  // in addition to chatConfig's fail-closed runtime validation.
  if (env.ENVIRONMENT === 'production') {
    for (const name of productionRequired) {
      if (!String(env[name] || '').trim()) blockers.push(blocker(`${name}_MISSING`));
    }
  }
  let cfg;
  try { cfg=chatConfig(env); } catch (error) { blockers.push(blocker(error.code)); }
  if (!env.DB) blockers.push(blocker('DATABASE_NOT_CONNECTED'));
  let policy=null, price=null, open=0;
  if (env.DB) {
    try { policy=await env.DB.prepare("SELECT enabled,global_daily_cost_microusd AS globalDailyCost FROM chat_billing_policy WHERE id='chat'").first(); }
    catch { blockers.push(blocker('BILLING_SCHEMA_NOT_READY')); }
    if (cfg) {
      try {
        price=await env.DB.prepare("SELECT id FROM provider_price_snapshots WHERE provider=? AND model=? AND retired_at IS NULL AND julianday(effective_at)<=julianday('now') AND julianday(valid_until)>julianday('now') ORDER BY julianday(effective_at) DESC LIMIT 1").bind(cfg.provider,cfg.model).first();
      } catch { blockers.push(blocker('PRICE_SCHEMA_NOT_READY')); }
    }
    try { const row=await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_reservations WHERE feature='chat_v2' AND status='reserved'").first(); open=Number(row?.n||0); }
    catch { blockers.push(blocker('RESERVATION_SCHEMA_NOT_READY')); }
  }
  if (policy?.enabled !== 1) blockers.push(blocker('BILLING_POLICY_DISABLED'));
  if (policy && (!Number.isSafeInteger(policy.globalDailyCost)||policy.globalDailyCost<1)) blockers.push(blocker('GLOBAL_BUDGET_INVALID'));
  const envBudget=Number(env.CHAT_GLOBAL_DAILY_COST_MICROUSD);
  if (policy && Number.isSafeInteger(envBudget) && envBudget>policy.globalDailyCost) blockers.push(blocker('ENV_BUDGET_EXCEEDS_DB_BUDGET'));
  if (cfg && !price) blockers.push(blocker('CURRENT_PRICE_SNAPSHOT_REQUIRED'));
  if (open>0) blockers.push(blocker('UNRESOLVED_RESERVATIONS',String(open)));
  return Object.freeze({eligible:blockers.length===0,safeOff:env.CHAT_EXECUTION_ENABLED!=='true',blockers,checks:Object.freeze({config:Boolean(cfg),billingPolicy:Boolean(policy?.enabled===1),currentPrice:Boolean(price),unresolvedReservations:open})});
}
