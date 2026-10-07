import {BillingError,whole} from './chat-billing.mjs';
import {chatGatewayRoute} from './chat-execution.mjs';
import {reconcileChat} from './chat-reconciliation.mjs';
import {fetchWithoutRedirect} from './safe-fetch.mjs';

const fail=()=>{throw new BillingError('RECONCILIATION_REQUIRED');};
const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
const providerIdPattern=/^[A-Za-z0-9._:-]{1,200}$/;

async function receiptJson(response,signal){
 if(!response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')||!response.body){
  try{await response.body?.cancel();}catch{}fail();
 }
 const reader=response.body.getReader(),chunks=[];let size=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});
 try{
  while(true){
   if(signal.aborted)fail();
   const {done,value}=await reader.read();
   if(signal.aborted)fail();
   if(done)break;
   size+=value.byteLength;if(size>16384){await reader.cancel();fail();}chunks.push(value);
  }
 }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail();}
}

// Privileged, explicit operator call only. No Worker endpoint, cron, retry loop,
// generation call or caller-supplied refund/usage evidence is attached here.
export async function reconcileChatFromGateway(env,reservationId,{fetcher=fetch}={}){
 if(env.ENVIRONMENT==='production'&&env.CHAT_RECONCILIATION_CONFIRMATION!=='UVENARO_RECONCILE_PAID_CHAT')
  throw new BillingError('RECONCILIATION_NOT_AUTHORIZED');
 if(env.CHAT_RECEIPT_LOOKUP_ENABLED!=='true')throw new BillingError('RECONCILIATION_NOT_AUTHORIZED');
 if(!env.DB)throw new BillingError('DATABASE_NOT_CONNECTED');
 if(typeof reservationId!=='string'||!idPattern.test(reservationId))throw new BillingError('INVALID_RESERVATION');
 const row=await env.DB.prepare(`SELECT r.*,p.provider,p.model FROM usage_reservations r
  JOIN provider_price_snapshots p ON p.id=r.price_snapshot_id WHERE r.id=? AND r.feature='chat_v2'
  AND r.status='reserved' AND r.provider_state IN ('started','unknown')`).bind(reservationId).first();
 // Agents have a separate authorization and reconciliation boundary.
 if(!row||row.idempotency_key.startsWith('agent_'))throw new BillingError('RESERVATION_NOT_FOUND');
 if(env.CHAT_PROVIDER_PROTOCOL!=='metered-v1'||!env.CHAT_RECEIPT_API_KEY||
  row.provider!==env.CHAT_PROVIDER||row.model!==env.CHAT_MODEL)fail();
 let route;
 try{
  route=chatGatewayRoute(env,env.CHAT_RECEIPT_BASE_URL);
  if(route.pathname.endsWith('/')||route.href!==env.CHAT_RECEIPT_BASE_URL)fail();
 }catch{fail();}
 const rawTimeout=String(env.CHAT_RECEIPT_TIMEOUT_MS??'10000');
 if(!/^\d+$/.test(rawTimeout)||!Number.isSafeInteger(Number(rawTimeout))||Number(rawTimeout)<100||Number(rawTimeout)>30000)fail();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(rawTimeout));
 let payload;
 try{
  const response=await fetchWithoutRedirect(route.href+'/'+encodeURIComponent(reservationId),{
   method:'GET',signal:controller.signal,cache:'no-store',
   headers:{authorization:'Bearer '+env.CHAT_RECEIPT_API_KEY,accept:'application/json'}
  },fetcher);
  payload=await receiptJson(response,controller.signal);
 }catch{fail();}finally{clearTimeout(timer);}
 if(!payload||payload.protocol!=='metered-v1'||payload.request_id!==row.id||
  payload.provider!==row.provider||payload.model!==row.model||typeof payload.id!=='string'||!providerIdPattern.test(payload.id))fail();
 const input=payload.usage?.input_tokens,output=payload.usage?.output_tokens;
 if(payload.status==='rejected'&&payload.billable===false&&input===0&&output===0)
  return reconcileChat(env,row.id,{outcome:'not_billed',providerRequestId:payload.id});
 if(payload.status!=='completed'||payload.billable!==true||!whole(input,row.input_token_limit)||!whole(output,row.output_token_limit))fail();
 return reconcileChat(env,row.id,{outcome:'charged',providerRequestId:payload.id,inputTokens:input,outputTokens:output});
}
