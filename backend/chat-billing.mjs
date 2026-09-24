// Server-authoritative billing. A single SQL statement plus database triggers
// atomically changes the reservation, account balance and append-only ledger.
const MAX_MONEY = 1_000_000_000_000;
const statuses = {
  DATABASE_NOT_CONNECTED:503, BILLING_NOT_READY:503, BILLING_UNAVAILABLE:503,
  BILLING_DISABLED:503, BILLING_RECONCILIATION_REQUIRED:503, PRICE_SNAPSHOT_REQUIRED:503,
  ACTIVE_SUBSCRIPTION_REQUIRED:402, USAGE_LIMITS_REQUIRED:503, USAGE_TEMPORARILY_BLOCKED:429,
  REQUEST_COST_LIMIT_EXCEEDED:402, INSUFFICIENT_CREDITS:402, RATE_LIMIT_REACHED:429,
  DAILY_QUOTA_REACHED:429, MONTHLY_QUOTA_REACHED:429, GLOBAL_SPEND_CEILING_REACHED:503,
  IDEMPOTENCY_CONFLICT:409, REQUEST_ALREADY_EXISTS:409, IDEMPOTENCY_REPLAY:409,
  INVALID_RESERVATION:400, RESERVATION_NOT_FOUND:404, DISPATCH_NOT_ALLOWED:409,
  INVALID_PROVIDER_USAGE:502, RECONCILIATION_REQUIRED:503, RESERVATION_FINALIZED:409
};
export class BillingError extends Error {
  constructor(code, receipt) { super(code); this.code=code; this.status=statuses[code]||503; this.receipt=receipt; }
}
export const whole = (value,max=MAX_MONEY) => Number.isSafeInteger(value)&&value>=0&&value<=max;
function requireDb(env) { if(!env.DB)throw new BillingError('DATABASE_NOT_CONNECTED'); return env.DB; }
function mapped(error) {
  if(error instanceof BillingError)return error;
  const message=String(error?.message||'');
  for(const code of Object.keys(statuses))if(message.includes(code))return new BillingError(code);
  if(/no such (table|column)|has no column/i.test(message))return new BillingError('BILLING_NOT_READY');
  return new BillingError('BILLING_UNAVAILABLE');
}
export function usageCost(inputTokens,outputTokens,price) {
  if(!whole(inputTokens,12000)||!whole(outputTokens,8000)||!whole(price.inputRate,1e9)||!whole(price.outputRate,1e9)||!whole(price.creditValue,1e9)||price.creditValue===0)throw new BillingError('INVALID_PROVIDER_USAGE');
  const numerator=BigInt(inputTokens)*BigInt(price.inputRate)+BigInt(outputTokens)*BigInt(price.outputRate);
  const cost=Number((numerator+999999n)/1000000n);
  const credits=Number((BigInt(cost)+BigInt(price.creditValue)-1n)/BigInt(price.creditValue));
  if(!whole(cost)||!whole(credits))throw new BillingError('INVALID_PROVIDER_USAGE');
  return {cost,credits};
}
async function digest(value) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
const selectReservation=`SELECT r.*,p.input_microusd_per_million AS inputRate,p.output_microusd_per_million AS outputRate,
  p.credit_value_microusd AS creditValue,p.provider,p.model FROM usage_reservations r
  JOIN provider_price_snapshots p ON p.id=r.price_snapshot_id`;
export function receipt(row) {
  return {id:row.id,status:row.status,providerState:row.provider_state,
    reservedCredits:row.status==='reserved'?row.estimated_credits:0,
    credits:row.actual_credits??null,inputTokens:row.input_tokens??null,outputTokens:row.output_tokens??null,
    reconciliationRequired:row.status==='reserved'&&row.provider_state!=='not_started'};
}
async function findByKey(db,owner,key) {return db.prepare(`${selectReservation} WHERE r.owner_id=? AND r.idempotency_key=?`).bind(owner,key).first();}
async function findById(db,owner,id) {return db.prepare(`${selectReservation} WHERE r.owner_id=? AND r.id=?`).bind(owner,id).first();}
function existingRequest(row,hash) {
  if(row.request_hash!==hash)throw new BillingError('IDEMPOTENCY_CONFLICT');
  throw new BillingError(row.status==='settled'?'IDEMPOTENCY_REPLAY':'REQUEST_ALREADY_EXISTS',receipt(row));
}
export async function reserveChat(env,user,key,messages,cfg) {
  const db=requireDb(env);
  if(!user?.verified||typeof user.sub!=='string'||!user.sub||!/^[A-Za-z0-9_-]{1,128}$/.test(key)||
    !whole(cfg.maxInputTokens,12000)||!cfg.maxInputTokens||!whole(cfg.maxOutputTokens,8000)||!cfg.maxOutputTokens||
    !whole(cfg.globalCeiling)||!cfg.globalCeiling)throw new BillingError('INVALID_RESERVATION');
  const hash=await digest({owner:user.sub,provider:cfg.provider,model:cfg.model,inputLimit:cfg.maxInputTokens,outputLimit:cfg.maxOutputTokens,messages});
  try {
    const existing=await findByKey(db,user.sub,key);if(existing)existingRequest(existing,hash);
    const price=await db.prepare(`SELECT id,input_microusd_per_million AS inputRate,output_microusd_per_million AS outputRate,
      credit_value_microusd AS creditValue FROM provider_price_snapshots WHERE provider=? AND model=? AND retired_at IS NULL
      AND julianday(effective_at)<=julianday('now') AND julianday(valid_until)>julianday('now') ORDER BY julianday(effective_at) DESC LIMIT 1`).bind(cfg.provider,cfg.model).first();
    if(!price)throw new BillingError('PRICE_SNAPSHOT_REQUIRED');
    // Reserve the full permitted input/output budget; never guess billable tokens from characters.
    const estimate=usageCost(cfg.maxInputTokens,cfg.maxOutputTokens,price);
    const id=crypto.randomUUID();
    try {
      await db.prepare(`INSERT INTO usage_reservations
        (id,owner_id,idempotency_key,feature,estimated_credits,estimated_cost_microusd,status,created_at,
         request_hash,price_snapshot_id,input_token_limit,output_token_limit,global_cost_ceiling,expires_at)
        VALUES (?,?,?,'chat_v2',?,?,'reserved',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'))`)
        .bind(id,user.sub,key,Math.max(1,estimate.credits),estimate.cost,hash,price.id,cfg.maxInputTokens,cfg.maxOutputTokens,cfg.globalCeiling).run();
    } catch(error) {
      // A concurrent duplicate or lost write response must never cause another provider call.
      const concurrent=await findByKey(db,user.sub,key);if(concurrent)existingRequest(concurrent,hash);
      throw error;
    }
    const row=await findById(db,user.sub,id);if(!row)throw new BillingError('BILLING_UNAVAILABLE');
    return row;
  }catch(error){throw mapped(error);}
}
export async function beginDispatch(env,user,reservation) {
  try {
    const out=await requireDb(env).prepare(`UPDATE usage_reservations SET provider_state='started'
      WHERE id=? AND owner_id=? AND status='reserved' AND provider_state='not_started'`).bind(reservation.id,user.sub).run();
    if(!out.meta?.changes)throw new BillingError('DISPATCH_NOT_ALLOWED');
  }catch(error){throw mapped(error);}
}
export async function markUnknown(env,user,reservation,reason='PROVIDER_OUTCOME_UNKNOWN') {
  try {await requireDb(env).prepare(`UPDATE usage_reservations SET provider_state='unknown',failure_code=?
    WHERE id=? AND owner_id=? AND status='reserved' AND provider_state IN ('started','unknown')`)
    .bind(reason,reservation.id,user.sub).run();}catch(error){throw mapped(error);}
}
export async function settleChat(env,user,reservation,usage,providerRequestId) {
  const db=requireDb(env);
  if(!whole(usage?.inputTokens,reservation.input_token_limit)||!whole(usage?.outputTokens,reservation.output_token_limit)||
    typeof providerRequestId!=='string'||!providerRequestId||providerRequestId.length>200)throw new BillingError('INVALID_PROVIDER_USAGE');
  const actual=usageCost(usage.inputTokens,usage.outputTokens,reservation);
  if(actual.cost>reservation.estimated_cost_microusd||actual.credits>reservation.estimated_credits)throw new BillingError('INVALID_PROVIDER_USAGE');
  try {
    await db.prepare(`UPDATE usage_reservations SET status='settled',provider_state='finished',actual_credits=?,actual_cost_microusd=?,
      input_tokens=?,output_tokens=?,provider_request_id=?,failure_code=NULL,settled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND owner_id=? AND status='reserved' AND provider_state IN ('started','unknown')`)
      .bind(actual.credits,actual.cost,usage.inputTokens,usage.outputTokens,providerRequestId,reservation.id,user.sub).run();
    const row=await findById(db,user.sub,reservation.id);if(!row)throw new BillingError('RESERVATION_NOT_FOUND');
    if(row.status!=='settled'||row.input_tokens!==usage.inputTokens||row.output_tokens!==usage.outputTokens||row.provider_request_id!==providerRequestId)
      throw new BillingError('RESERVATION_FINALIZED',receipt(row));
    return receipt(row);
  }catch(error){throw mapped(error);}
}
export async function releaseChat(env,user,reservation,{confirmedNotBilled=false,providerRequestId=null}={}) {
  const db=requireDb(env);
  if(confirmedNotBilled&&(typeof providerRequestId!=='string'||!providerRequestId||providerRequestId.length>200))throw new BillingError('RECONCILIATION_REQUIRED');
  try {
    await db.prepare(`UPDATE usage_reservations SET status='released',provider_state='finished',actual_credits=0,actual_cost_microusd=0,
      input_tokens=0,output_tokens=0,provider_request_id=?,failure_code=?,settled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND owner_id=? AND status='reserved' AND (provider_state='not_started' OR ?=1)`)
      .bind(providerRequestId,confirmedNotBilled?'CONFIRMED_NOT_BILLED':'NOT_DISPATCHED',reservation.id,user.sub,confirmedNotBilled?1:0).run();
    const row=await findById(db,user.sub,reservation.id);if(!row)throw new BillingError('RESERVATION_NOT_FOUND');
    if(row.status!=='released')throw new BillingError('RECONCILIATION_REQUIRED',receipt(row));
    return receipt(row);
  }catch(error){throw mapped(error);}
}
export async function getChatReceipt(env,user,key) {
  try {
    const row=await findByKey(requireDb(env),user.sub,key);if(!row)throw new BillingError('RESERVATION_NOT_FOUND');
    return receipt(row);
  }catch(error){throw mapped(error);}
}
export async function expireUndispatched(env) {
  try {
    return await requireDb(env).prepare(`UPDATE usage_reservations SET status='released',provider_state='finished',actual_credits=0,
      actual_cost_microusd=0,input_tokens=0,output_tokens=0,failure_code='NOT_DISPATCHED',settled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id IN (SELECT id FROM usage_reservations WHERE feature='chat_v2' AND status='reserved' AND provider_state='not_started'
        AND julianday(expires_at)<=julianday('now') ORDER BY expires_at LIMIT 100)`).run();
  }catch(error){throw mapped(error);}
}
export async function stopBilling(env) {
  try {await requireDb(env).prepare("UPDATE chat_billing_policy SET enabled=0,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='chat'").run();}
  catch(error){throw mapped(error);}
}
