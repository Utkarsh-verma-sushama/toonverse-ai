import {BillingError, settleChat, releaseChat} from './chat-billing.mjs';

const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
const providerIdPattern=/^[A-Za-z0-9._:-]{1,200}$/;
const agentKeyPattern=/^agent_[A-Za-z0-9_-]{1,128}$/;
function db(env){if(!env.DB)throw new BillingError('DATABASE_NOT_CONNECTED');return env.DB;}
function authorize(env){
 if(env.ENVIRONMENT==='production'&&env.AGENT_RECONCILIATION_CONFIRMATION!=='UVENARO_RECONCILE_PAID_AGENT')
  throw new BillingError('RECONCILIATION_NOT_AUTHORIZED');
}
// Internal/operator boundary only. No public Worker route.
export async function listAgentReconciliation(env,{limit=100}={}){
 authorize(env);const size=Number.isSafeInteger(limit)?Math.max(1,Math.min(100,limit)):100;
 try{
  const rows=await db(env).prepare(`SELECT r.id,r.owner_id AS ownerId,r.idempotency_key AS idempotencyKey,p.provider,p.model,
   r.estimated_credits AS estimatedCredits,r.estimated_cost_microusd AS estimatedCostMicroUsd,
   r.input_token_limit AS inputTokenLimit,r.output_token_limit AS outputTokenLimit,r.provider_state AS providerState,
   r.failure_code AS failureCode,r.created_at AS createdAt FROM usage_reservations r
   JOIN provider_price_snapshots p ON p.id=r.price_snapshot_id
   WHERE r.feature='chat_v2' AND r.idempotency_key LIKE 'agent\\_%' ESCAPE '\\'
   AND r.status='reserved' AND r.provider_state IN ('started','unknown')
   ORDER BY r.created_at ASC LIMIT ?`).bind(size).all();
  return (rows.results||[]).filter(row=>agentKeyPattern.test(String(row.idempotencyKey||'')));
 }catch(error){if(error instanceof BillingError)throw error;if(/no such (table|column)/i.test(String(error?.message||'')))throw new BillingError('BILLING_NOT_READY');throw new BillingError('BILLING_UNAVAILABLE');}
}
export async function reconcileAgent(env,reservationId,evidence={}){
 authorize(env);
 if(typeof reservationId!=='string'||!idPattern.test(reservationId))throw new BillingError('INVALID_RESERVATION');
 const row=await db(env).prepare("SELECT r.*,p.input_microusd_per_million AS inputRate,p.output_microusd_per_million AS outputRate,p.credit_value_microusd AS creditValue FROM usage_reservations r JOIN provider_price_snapshots p ON p.id=r.price_snapshot_id WHERE r.id=? AND r.feature='chat_v2' AND r.idempotency_key LIKE 'agent\\_%' ESCAPE '\\' AND r.status='reserved' AND r.provider_state IN ('started','unknown')").bind(reservationId).first();
 if(!row||!agentKeyPattern.test(String(row.idempotency_key||'')))throw new BillingError('RESERVATION_NOT_FOUND');
 if(!evidence||!['charged','not_billed'].includes(evidence.outcome)||!providerIdPattern.test(String(evidence.providerRequestId||'')))throw new BillingError('RECONCILIATION_REQUIRED');
 const user={sub:row.owner_id};
 if(evidence.outcome==='not_billed')return releaseChat(env,user,row,{confirmedNotBilled:true,providerRequestId:evidence.providerRequestId});
 if(!Number.isSafeInteger(evidence.inputTokens)||!Number.isSafeInteger(evidence.outputTokens))throw new BillingError('INVALID_PROVIDER_USAGE');
 return settleChat(env,user,row,{inputTokens:evidence.inputTokens,outputTokens:evidence.outputTokens},evidence.providerRequestId);
}
