import {reserveChat,beginDispatch,settleChat,releaseChat,markUnknown,stopBilling,whole} from './chat-billing.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
function setting(env,name,fallback,min,max){
 const value=env[name]===undefined?String(fallback):String(env[name]);
 if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)throw fail('CHAT_CONFIGURATION_INVALID',503);
 return Number(value);
}
export function chatConfig(env){
 if(env.CHAT_EXECUTION_ENABLED!=='true')return {enabled:false};
 const cfg={enabled:true,provider:String(env.CHAT_PROVIDER||''),model:String(env.CHAT_MODEL||''),url:String(env.CHAT_PROVIDER_URL||''),
  maxInputTokens:setting(env,'CHAT_MAX_INPUT_TOKENS',4000,1,12000),maxOutputTokens:setting(env,'CHAT_MAX_OUTPUT_TOKENS',1000,1,8000),
  timeoutMs:setting(env,'CHAT_TIMEOUT_MS',30000,1000,120000),globalCeiling:setting(env,'CHAT_GLOBAL_DAILY_COST_MICROUSD',0,1,1e12)};
 if(!env.CHAT_PROVIDER_API_KEY||!cfg.provider||!cfg.model||env.CHAT_PROVIDER_PROTOCOL!=='metered-v1')throw fail('PROVIDER_NOT_CONFIGURED',503);
 let url;try{url=new URL(cfg.url);}catch{throw fail('PROVIDER_NOT_CONFIGURED',503);}
 if(url.protocol!=='https:'||url.origin!==env.CHAT_PROVIDER_ALLOWED_ORIGIN||url.username||url.password||url.search||url.hash)throw fail('PROVIDER_ROUTE_NOT_ALLOWED',503);
 return cfg;
}
export function normalizeMessages(input){
 if(!input||typeof input.message!=='string'||!input.message.trim()||input.message.length>12000)throw fail('INVALID_MESSAGE',400);
 const messages=[];
 if(input.conversation!==undefined){
  if(!Array.isArray(input.conversation)||input.conversation.length>40)throw fail('INVALID_CONVERSATION',400);
  for(const item of input.conversation){
   if(!item||!['user','assistant'].includes(item.role)||typeof item.content!=='string'||!item.content.trim()||item.content.length>12000)throw fail('INVALID_CONVERSATION',400);
   messages.push({role:item.role,content:item.content});
  }
 }
 if(messages.at(-1)?.role!=='user'||messages.at(-1)?.content!==input.message)messages.push({role:'user',content:input.message});
 if(messages.reduce((size,item)=>size+item.content.length,0)>12000)throw fail('CONVERSATION_LIMIT_EXCEEDED',413);
 return messages;
}
async function boundedJson(response){
 if(!response.body)throw fail('INVALID_PROVIDER_RESPONSE',502);
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw fail('INVALID_PROVIDER_RESPONSE',502);}chunks.push(value);}}
 finally{reader.releaseLock();}
 const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw fail('INVALID_PROVIDER_RESPONSE',502);}
}
function validEnvelope(payload,reservation,cfg){
 return payload&&typeof payload==='object'&&payload.request_id===reservation.id&&payload.model===cfg.model&&
  typeof payload.id==='string'&&payload.id.length>0&&payload.id.length<=200;
}
async function holdUnknown(env,user,reservation,reason){
 // A failed state write never releases the durable reservation. It remains held
 // for reconciliation even if the process dies before marking it unknown.
 try{await markUnknown(env,user,reservation,reason);}catch{console.error('CHAT_RECONCILIATION_WRITE_FAILED',reservation.id);}
}
export async function executeChat(request,env,user,readBody){
 let cfg;
 try{cfg=chatConfig(env);}catch(error){return json({code:error.code},error.status);}
 if(!cfg.enabled)return json({code:'CHAT_EXECUTION_DISABLED',message:'AI chat is not enabled.'},503);
 if(!user.verified)return json({code:'VERIFIED_IDENTITY_REQUIRED'},401);
 const key=request.headers.get('idempotency-key')||'';
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(key))return json({code:'VALID_IDEMPOTENCY_KEY_REQUIRED'},400);
 const input=await readBody(request);let messages;
 try{messages=normalizeMessages(input);}catch(error){return json({code:error.code},error.status);}
 if(request.signal.aborted)return json({code:'REQUEST_CANCELLED'},499);
 const reservation=await reserveChat(env,user,key,messages,cfg);
 if(request.signal.aborted){await releaseChat(env,user,reservation);return json({code:'REQUEST_CANCELLED'},499);}
 try{await beginDispatch(env,user,reservation);}catch(error){
  // A known pre-dispatch rejection may be released. If the write's outcome is
  // uncertain, releaseChat refuses to undo a started reservation.
  try{await releaseChat(env,user,reservation);}catch{}
  throw error;
 }
 const controller=new AbortController();const cancel=()=>controller.abort();
 request.signal.addEventListener('abort',cancel,{once:true});if(request.signal.aborted)cancel();
 const timer=setTimeout(cancel,cfg.timeoutMs);let payload,upstream;
 try{
  upstream=await fetch(cfg.url,{method:'POST',redirect:'error',signal:controller.signal,headers:{
   authorization:`Bearer ${env.CHAT_PROVIDER_API_KEY}`,'content-type':'application/json','idempotency-key':reservation.id},
   body:JSON.stringify({protocol:'metered-v1',request_id:reservation.id,model:cfg.model,messages,
    max_input_tokens:cfg.maxInputTokens,max_output_tokens:cfg.maxOutputTokens,tools:[],store:false})});
  payload=await boundedJson(upstream);
 }catch(error){
  await holdUnknown(env,user,reservation,controller.signal.aborted?'PROVIDER_TIMEOUT_OR_CANCEL':'PROVIDER_OUTCOME_UNKNOWN');
  return json({code:'RECONCILIATION_REQUIRED',reservationId:reservation.id,message:'Request outcome is being checked. Credits remain reserved and have not been charged.'},503);
 }finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
 if(validEnvelope(payload,reservation,cfg)&&payload.status==='rejected'&&payload.billable===false&&payload.usage?.input_tokens===0&&payload.usage?.output_tokens===0){
  await releaseChat(env,user,reservation,{confirmedNotBilled:true,providerRequestId:payload.id});
  return json({code:'PROVIDER_REJECTED',reservationId:reservation.id,creditsCharged:0},503);
 }
 const validUsage=whole(payload?.usage?.input_tokens,cfg.maxInputTokens)&&whole(payload?.usage?.output_tokens,cfg.maxOutputTokens);
 if(!upstream.ok||!validEnvelope(payload,reservation,cfg)||payload.status!=='completed'||!validUsage||typeof payload.output!=='string'||!payload.output.trim()||payload.output.length>32000){
  // A broken cost contract must stop further spending, rather than quietly
  // clamping the user's charge and allowing unlimited unaccounted provider cost.
  try{await stopBilling(env);}catch{console.error('CHAT_BILLING_STOP_FAILED',reservation.id);}
  await holdUnknown(env,user,reservation,'PROVIDER_CONTRACT_VIOLATION');
  return json({code:'RECONCILIATION_REQUIRED',reservationId:reservation.id},503);
 }
 let usage;
 try{usage=await settleChat(env,user,reservation,{inputTokens:payload.usage.input_tokens,outputTokens:payload.usage.output_tokens},payload.id);}
 catch(error){
  await holdUnknown(env,user,reservation,'SETTLEMENT_UNCONFIRMED');
  // Never release here: the provider has completed billable work, and a lost DB
  // response may mean the settlement already committed.
  return json({code:'RECONCILIATION_REQUIRED',reservationId:reservation.id},503);
 }
 return json({id:reservation.id,output:payload.output,usage:{credits:usage.credits,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens}});
}
