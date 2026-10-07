import {whole} from './chat-billing.mjs';
import {fetchWithoutRedirect} from './safe-fetch.mjs';
const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
const recordPattern=/^[A-Za-z0-9._:-]{1,200}$/;
export const failure=(code,status=503)=>Object.assign(new Error(code),{code,status});
export const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'}});
export async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function authorized(request,key){
 const supplied=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(request.headers.get('authorization')||'')?.[1];
 if(!supplied||typeof key!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(key))return false;
 const a=await hash(supplied),b=await hash(key);let different=0;
 for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);
 return different===0;
}
function config(env){
 if(!env.DB||!env.GATEWAY_DB||!['test','staging','production'].includes(env.ENVIRONMENT)||
  typeof env.GATEWAY_DISPATCH_KEY!=='string'||typeof env.GATEWAY_RECEIPT_KEY!=='string'||env.GATEWAY_DISPATCH_KEY===env.GATEWAY_RECEIPT_KEY||
  !/^[A-Za-z0-9_-]{32,256}$/.test(env.GATEWAY_DISPATCH_KEY)||!/^[A-Za-z0-9_-]{32,256}$/.test(env.GATEWAY_RECEIPT_KEY)||
  !/^[A-Za-z0-9._:-]{1,128}$/.test(env.GATEWAY_PROVIDER||'')||!/^[A-Za-z0-9._:-]{1,128}$/.test(env.GATEWAY_MODEL||''))throw failure('GATEWAY_NOT_CONFIGURED');
}
function adapterConfig(env){
 if(!env.PROVIDER_ADAPTER?.fetch||env.GATEWAY_ADAPTER_PROTOCOL!=='bounded-metered-v1')throw failure('GATEWAY_ADAPTER_UNAVAILABLE');
 if(!/^[A-Za-z0-9_-]{32,256}$/.test(env.GATEWAY_ADAPTER_DISPATCH_KEY||'')||
  !/^[A-Za-z0-9_-]{32,256}$/.test(env.GATEWAY_ADAPTER_RECEIPT_KEY||'')||env.GATEWAY_ADAPTER_DISPATCH_KEY===env.GATEWAY_ADAPTER_RECEIPT_KEY)throw failure('GATEWAY_ADAPTER_UNAVAILABLE');
 if(env.ENVIRONMENT==='production'&&env.GATEWAY_PROVIDER_ADAPTER_AUDITED!=='true')throw failure('GATEWAY_ADAPTER_AUDIT_REQUIRED');
 const timeout=String(env.GATEWAY_TIMEOUT_MS??'30000');
 if(!/^\d+$/.test(timeout)||!Number.isSafeInteger(Number(timeout))||Number(timeout)<100||Number(timeout)>120000)throw failure('GATEWAY_NOT_CONFIGURED');
 return Number(timeout);
}
export async function boundedJson(response,signal,limit){
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')||!response.body)throw failure('GATEWAY_INVALID_BODY',400);
 const reader=response.body.getReader(),chunks=[];let length=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{
  while(true){
   if(signal.aborted){cancel();throw failure('GATEWAY_TIMEOUT');}
   const {done,value}=await reader.read();if(signal.aborted)throw failure('GATEWAY_TIMEOUT');if(done)break;
   length+=value.byteLength;if(length>limit){cancel();throw failure('GATEWAY_INVALID_BODY',413);}chunks.push(value);
  }
 }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw failure('GATEWAY_INVALID_BODY',400);}
}
export function inputPayload(body){
 if(body?.protocol!=='metered-v1'||!idPattern.test(body.request_id||'')||typeof body.model!=='string'||body.store!==false||
  !Array.isArray(body.tools)||body.tools.length||!whole(body.max_input_tokens,12000)||!body.max_input_tokens||
  !whole(body.max_output_tokens,8000)||!body.max_output_tokens||!Array.isArray(body.messages)||!body.messages.length||body.messages.length>41)
  throw failure('GATEWAY_INVALID_REQUEST',400);
 const messages=body.messages.map(item=>{
  if(!item||!['user','assistant'].includes(item.role)||typeof item.content!=='string'||!item.content.trim()||item.content.length>12000)throw failure('GATEWAY_INVALID_REQUEST',400);
  return {role:item.role,content:item.content};
 });
 if(messages.reduce((n,m)=>n+m.content.length,0)>12000)throw failure('GATEWAY_INVALID_REQUEST',413);
 return {...body,messages};
}
export async function get(env,id){return env.GATEWAY_DB.prepare('SELECT * FROM gateway_receipts WHERE request_id=?').bind(id).first();}
export function envelope(row){
 return {protocol:'metered-v1',request_id:row.request_id,provider:row.provider,model:row.model,
  id:row.record_id||'gateway_'+row.request_id,status:row.status,billable:row.billable===null?null:row.billable===1,
  usage:row.input_tokens===null?null:{input_tokens:row.input_tokens,output_tokens:row.output_tokens}};
}
function evidence(payload,row,needsOutput){
 if(payload?.protocol!=='metered-v1'||payload.request_id!==row.request_id||payload.provider!==row.provider||payload.model!==row.model||
  typeof payload.id!=='string'||!recordPattern.test(payload.id))throw failure('GATEWAY_PROVIDER_CONTRACT_VIOLATION');
 if(payload.status==='rejected'&&payload.billable===false&&payload.usage?.input_tokens===0&&payload.usage?.output_tokens===0)return payload;
 if(payload.status!=='completed'||payload.billable!==true||!whole(payload.usage?.input_tokens,row.input_limit)||!whole(payload.usage?.output_tokens,row.output_limit)||
  (needsOutput&&(typeof payload.output!=='string'||!payload.output.trim()||payload.output.length>32000)))throw failure('GATEWAY_PROVIDER_CONTRACT_VIOLATION');
 return payload;
}
export async function finalize(env,row,payload){
 await env.GATEWAY_DB.prepare(`UPDATE gateway_receipts SET status=?,record_id=?,billable=?,input_tokens=?,output_tokens=?,
  finalized_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE request_id=? AND status IN ('dispatching','unknown')`)
  .bind(payload.status,payload.id,payload.billable?1:0,payload.usage.input_tokens,payload.usage.output_tokens,row.request_id).run();
 const saved=await get(env,row.request_id);
 if(!saved||saved.status!==payload.status||saved.record_id!==payload.id||saved.billable!==(payload.billable?1:0)||
  saved.input_tokens!==payload.usage.input_tokens||saved.output_tokens!==payload.usage.output_tokens)throw failure('GATEWAY_FINALIZATION_UNCONFIRMED');
 return saved;
}
export async function unknown(env,id,stop=false){
 if(stop)try{await env.GATEWAY_DB.prepare("UPDATE gateway_control SET enabled=0 WHERE id='gateway'").run();}catch{}
 try{await env.GATEWAY_DB.prepare("UPDATE gateway_receipts SET status='unknown' WHERE request_id=? AND status='dispatching'").bind(id).run();}catch{}
}
async function callAdapter(env,path,{method,body,limit},timeout){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetchWithoutRedirect('https://adapter.internal'+path,{method,signal:controller.signal,
   headers:{'content-type':'application/json',accept:'application/json',authorization:'Bearer '+(method==='POST'?env.GATEWAY_ADAPTER_DISPATCH_KEY:env.GATEWAY_ADAPTER_RECEIPT_KEY)},...(body?{body:JSON.stringify(body)}:{})},
   (url,options)=>new Promise((resolve,reject)=>{
    const abort=()=>reject(failure('GATEWAY_TIMEOUT'));
    options.signal.addEventListener('abort',abort,{once:true});
    if(options.signal.aborted){options.signal.removeEventListener('abort',abort);abort();return;}
    Promise.resolve().then(()=>env.PROVIDER_ADAPTER.fetch(new Request(url,options))).then(response=>{
     options.signal.removeEventListener('abort',abort);
     if(options.signal.aborted){void response.body?.cancel().catch(()=>{});abort();}else resolve(response);
    },error=>{options.signal.removeEventListener('abort',abort);reject(error);});
   }));
  if(!response.ok){void response.body?.cancel().catch(()=>{});throw failure('GATEWAY_ADAPTER_UNCERTAIN');}
  return await boundedJson(response,controller.signal,limit);
 }catch(error){
  if(error.message==='UPSTREAM_REDIRECT_BLOCKED')throw failure('GATEWAY_PROVIDER_CONTRACT_VIOLATION');
  throw error;
 }finally{clearTimeout(timer);}
}
async function generate(request,env){
 if(env.GATEWAY_GENERATION_ENABLED!=='true')throw failure('GATEWAY_GENERATION_DISABLED');
 if(env.ENVIRONMENT==='production'&&env.GATEWAY_PAID_EXECUTION_CONFIRMATION!=='UVENARO_ENABLE_PAID_GATEWAY')throw failure('GATEWAY_PAID_CONFIRMATION_REQUIRED');
 const timeout=adapterConfig(env),body=inputPayload(await boundedJson(request,AbortSignal.timeout(5000),65536));
 if(request.headers.get('idempotency-key')!==body.request_id)throw failure('GATEWAY_INVALID_REQUEST',400);
 if(await get(env,body.request_id))throw failure('GATEWAY_REQUEST_ALREADY_EXISTS',409);
 const reservation=await env.DB.prepare(`SELECT r.*,p.provider,p.model FROM usage_reservations r JOIN provider_price_snapshots p ON p.id=r.price_snapshot_id
  WHERE r.id=? AND r.feature='chat_v2' AND r.status='reserved' AND r.provider_state='started'
  AND julianday(r.expires_at)>julianday('now')`).bind(body.request_id).first();
 if(!reservation||reservation.idempotency_key.startsWith('agent_')||reservation.provider!==env.GATEWAY_PROVIDER||reservation.model!==env.GATEWAY_MODEL||
  body.model!==reservation.model||body.max_input_tokens!==reservation.input_token_limit||body.max_output_tokens!==reservation.output_token_limit)throw failure('GATEWAY_RESERVATION_REQUIRED',409);
 const requestHash=await hash(JSON.stringify({owner:reservation.owner_id,provider:reservation.provider,model:reservation.model,
  inputLimit:body.max_input_tokens,outputLimit:body.max_output_tokens,messages:body.messages}));
 if(requestHash!==reservation.request_hash)throw failure('GATEWAY_REQUEST_CONFLICT',409);
 // Durable single claimant before dispatch. An ambiguous insert is never retried
 // as generation, even if its write succeeded but the response was lost.
 try{
  const claim=await env.GATEWAY_DB.prepare(`INSERT INTO gateway_receipts
   (request_id,request_hash,provider,model,input_limit,output_limit,status,created_at)
   VALUES (?,?,?,?,?,?,'dispatching',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
   .bind(reservation.id,requestHash,reservation.provider,reservation.model,reservation.input_token_limit,reservation.output_token_limit).run();
  if(claim.meta?.changes!==1)throw failure('GATEWAY_CLAIM_UNCONFIRMED');
 }catch{throw failure('GATEWAY_CLAIM_UNCONFIRMED');}
 const row=await get(env,reservation.id);
 if(!row)throw failure('GATEWAY_CLAIM_UNCONFIRMED');
 try{
  const control=await env.GATEWAY_DB.prepare("SELECT enabled FROM gateway_control WHERE id='gateway'").first();
  const policy=await env.DB.prepare("SELECT enabled FROM chat_billing_policy WHERE id='chat'").first();
  if(control?.enabled!==1||policy?.enabled!==1||request.signal.aborted){
   const rejected={...envelope(row),status:'rejected',billable:false,usage:{input_tokens:0,output_tokens:0}};
   return json(envelope(await finalize(env,row,rejected)),503);
  }
  // Pass only the bounded contract fields; no client extras can become tools.
  const payload=evidence(await callAdapter(env,'/responses',{method:'POST',limit:262144,body:{protocol:'metered-v1',request_id:row.request_id,
   provider:row.provider,model:row.model,messages:body.messages,max_input_tokens:row.input_limit,max_output_tokens:row.output_limit,tools:[],store:false}},timeout),row,true);
  const saved=await finalize(env,row,payload);
  return json({...envelope(saved),...(payload.status==='completed'?{output:payload.output}:{})},payload.status==='completed'?200:503);
 }catch(error){
  await unknown(env,row.request_id,error.code==='GATEWAY_PROVIDER_CONTRACT_VIOLATION'||error.code==='GATEWAY_INVALID_BODY');
  return json({code:'RECONCILIATION_REQUIRED',request_id:row.request_id},503);
 }
}
// Explicit operator invocation only; no HTTP/cron route. Looks up durable
// adapter evidence by original request ID and never repeats generation.
export async function recoverGatewayReceipt(env,id){
 config(env);
 if(env.GATEWAY_RECOVERY_ENABLED!=='true'||(env.ENVIRONMENT==='production'&&env.GATEWAY_RECOVERY_CONFIRMATION!=='UVENARO_RECOVER_GATEWAY_RECEIPTS'))throw failure('GATEWAY_RECOVERY_NOT_AUTHORIZED');
 if(!idPattern.test(id||''))throw failure('GATEWAY_INVALID_REQUEST',400);
 const row=await get(env,id);if(!row)throw failure('GATEWAY_RECEIPT_NOT_FOUND',404);
 if(['completed','rejected'].includes(row.status))return envelope(row);
 if(row.provider!==env.GATEWAY_PROVIDER||row.model!==env.GATEWAY_MODEL)throw failure('GATEWAY_REQUEST_CONFLICT');
 try{
  const payload=evidence(await callAdapter(env,'/receipts/'+encodeURIComponent(id),{method:'GET',limit:16384},adapterConfig(env)),row,false);
  return envelope(await finalize(env,row,payload));
 }catch(error){await unknown(env,id,error.code==='GATEWAY_PROVIDER_CONTRACT_VIOLATION'||error.code==='GATEWAY_INVALID_BODY');throw failure('RECONCILIATION_REQUIRED');}
}
export default {
 async fetch(request,env){
  try{
   config(env);const path=new URL(request.url).pathname;
   if(path==='/responses'&&request.method==='POST'){
    if(!await authorized(request,env.GATEWAY_DISPATCH_KEY))throw failure('GATEWAY_UNAUTHORIZED',401);
    return await generate(request,env);
   }
   const id=/^\/receipts\/([A-Za-z0-9_-]{1,128})$/.exec(path)?.[1];
   if(id&&request.method==='GET'){
    if(!await authorized(request,env.GATEWAY_RECEIPT_KEY))throw failure('GATEWAY_UNAUTHORIZED',401);
    const row=await get(env,id);if(!row)throw failure('GATEWAY_RECEIPT_NOT_FOUND',404);
    return json(envelope(row));
   }
   return json({code:'GATEWAY_NOT_FOUND'},404);
  }catch(error){return json({code:error.code||'GATEWAY_UNAVAILABLE'},error.status||503);}
 }
};
