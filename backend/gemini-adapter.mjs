import {whole} from './chat-billing.mjs';
import {validateProviderContract,requireProviderContract} from './provider-contract.mjs';
import {fetchWithoutRedirect} from './safe-fetch.mjs';
import {failure,json,hash,authorized,boundedJson,inputPayload,get,envelope,finalize,unknown} from './metered-gateway.mjs';
const provider='google-gemini';
const state=env=>({GATEWAY_DB:env.ADAPTER_DB});
function config(env){
 const profile=validateProviderContract(env,{allowBlankModel:true});
 if(!profile.ok||!env.ADAPTER_DB||!env.GATEWAY_DB||!env.DB||!['test','staging','production'].includes(env.ENVIRONMENT)||
  !/^[A-Za-z0-9_-]{32,256}$/.test(env.ADAPTER_DISPATCH_KEY||'')||!/^[A-Za-z0-9_-]{32,256}$/.test(env.ADAPTER_RECEIPT_KEY||'')||env.ADAPTER_DISPATCH_KEY===env.ADAPTER_RECEIPT_KEY)
  throw failure('ADAPTER_NOT_CONFIGURED');
}
function generationConfig(env){
 if(env.GEMINI_GENERATION_ENABLED!=='true')throw failure('ADAPTER_GENERATION_DISABLED');
 if(env.ENVIRONMENT==='production'&&env.GEMINI_EXECUTION_CONFIRMATION!=='UVENARO_ENABLE_GEMINI_GENERATION')throw failure('ADAPTER_CONFIRMATION_REQUIRED');
 const contract=requireProviderContract(env);
 for(const name of contract.requiredAuditFlags)
  if(env[name]!=='true')throw failure('ADAPTER_AUDIT_REQUIRED');
 if(typeof env.GEMINI_API_KEY!=='string'||!env.GEMINI_API_KEY||env.GEMINI_API_KEY.length>256||/[\r\n]/.test(env.GEMINI_API_KEY))throw failure('ADAPTER_NOT_CONFIGURED');
 const margin=String(env.GEMINI_PREFLIGHT_TOKEN_MARGIN??'32'),timeout=String(env.GEMINI_TIMEOUT_MS??'30000');
 if(!/^\d+$/.test(margin)||!whole(Number(margin),1024)||Number(margin)<16||!/^\d+$/.test(timeout)||Number(timeout)<100||Number(timeout)>120000)throw failure('ADAPTER_NOT_CONFIGURED');
 return {margin:Number(margin),timeout:Number(timeout),contract};
}
async function vendorCall(env,method,body,timeout){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetchWithoutRedirect('https://generativelanguage.googleapis.com/v1beta/models/'+env.GEMINI_MODEL+':'+method,
   {method:'POST',signal:controller.signal,headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify(body)},
   (url,options)=>new Promise((resolve,reject)=>{
    const abort=()=>reject(failure('ADAPTER_VENDOR_UNCERTAIN'));options.signal.addEventListener('abort',abort,{once:true});
    if(options.signal.aborted){options.signal.removeEventListener('abort',abort);abort();return;}
    Promise.resolve().then(()=>fetch(url,options)).then(response=>{
     options.signal.removeEventListener('abort',abort);
     if(options.signal.aborted){void response.body?.cancel().catch(()=>{});abort();}else resolve(response);
    },error=>{options.signal.removeEventListener('abort',abort);reject(error);});
   }));
  if(!response.ok){void response.body?.cancel().catch(()=>{});throw failure('ADAPTER_VENDOR_UNCERTAIN');}
  return await boundedJson(response,controller.signal,262144);
 }finally{clearTimeout(timer);}
}
async function projectedReceipt(env,id){
 const row=await get(state(env),id);if(!row)return null;
 if(['completed','rejected'].includes(row.status))return envelope(row);
 const saved=await env.ADAPTER_DB.prepare('SELECT * FROM adapter_vendor_evidence WHERE request_id=?').bind(id).first();
 if(!saved)return envelope(row);
 // GET remains read-only. A committed vendor-evidence write can be projected
 // even if the subsequent receipt finalization acknowledgement was lost.
 return envelope({...row,status:'completed',record_id:saved.record_id,billable:1,input_tokens:saved.input_tokens,output_tokens:saved.output_tokens});
}
async function rejected(env,row){
 const payload={...envelope(row),status:'rejected',billable:false,usage:{input_tokens:0,output_tokens:0}};
 return json(envelope(await finalize(state(env),row,payload)));
}
async function generate(request,env){
 const cfg=generationConfig(env),body=inputPayload(await boundedJson(request,AbortSignal.timeout(5000),65536));
 if(body.provider!==provider||body.model!==env.GEMINI_MODEL||body.messages.at(-1).role!=='user')throw failure('ADAPTER_INVALID_REQUEST',400);
 if(await get(state(env),body.request_id))throw failure('ADAPTER_REQUEST_ALREADY_EXISTS',409);
 const billing=await env.DB.prepare(`SELECT r.*,p.provider,p.model FROM usage_reservations r JOIN provider_price_snapshots p ON p.id=r.price_snapshot_id
  WHERE r.id=? AND r.status='reserved' AND r.provider_state='started' AND r.feature='chat_v2' AND julianday(r.expires_at)>julianday('now')`).bind(body.request_id).first();
 const claim=await get(env,body.request_id);
 if(!billing||!claim||claim.status!=='dispatching'||billing.idempotency_key.startsWith('agent_')||billing.provider!==provider||billing.model!==env.GEMINI_MODEL||
  body.max_input_tokens!==billing.input_token_limit||body.max_output_tokens!==billing.output_token_limit||claim.request_hash!==billing.request_hash||
  claim.provider!==provider||claim.model!==env.GEMINI_MODEL||claim.input_limit!==billing.input_token_limit||claim.output_limit!==billing.output_token_limit)throw failure('ADAPTER_RESERVATION_REQUIRED',409);
 const requestHash=await hash(JSON.stringify({owner:billing.owner_id,provider,model:env.GEMINI_MODEL,inputLimit:body.max_input_tokens,outputLimit:body.max_output_tokens,messages:body.messages}));
 if(requestHash!==billing.request_hash)throw failure('ADAPTER_REQUEST_CONFLICT',409);
 try{
  const inserted=await env.ADAPTER_DB.prepare(`INSERT INTO gateway_receipts (request_id,request_hash,provider,model,input_limit,output_limit,status,created_at)
   VALUES (?,?,?,?,?,?,'dispatching',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(body.request_id,requestHash,provider,env.GEMINI_MODEL,body.max_input_tokens,body.max_output_tokens).run();
  if(inserted.meta?.changes!==1)throw failure('ADAPTER_CLAIM_UNCONFIRMED');
 }catch{throw failure('ADAPTER_CLAIM_UNCONFIRMED');}
 const row=await get(state(env),body.request_id);if(!row)throw failure('ADAPTER_CLAIM_UNCONFIRMED');
 const vendorBody={contents:body.messages.map(item=>({role:item.role==='assistant'?'model':'user',parts:[{text:item.content}]})),
  generationConfig:{candidateCount:1,maxOutputTokens:row.output_limit,thinkingConfig:{thinkingLevel:cfg.contract.controls.thinkingLevel,includeThoughts:false}}};
 let dispatched=false;const startedAt=Date.now();
 const remaining=()=>{const value=cfg.timeout-(Date.now()-startedAt);if(value<=0)throw failure('ADAPTER_VENDOR_UNCERTAIN');return value;};
 try{
  const adapterControl=await env.ADAPTER_DB.prepare("SELECT enabled FROM gateway_control WHERE id='gateway'").first();
  const gatewayControl=await env.GATEWAY_DB.prepare("SELECT enabled FROM gateway_control WHERE id='gateway'").first();
  const policy=await env.DB.prepare("SELECT enabled FROM chat_billing_policy WHERE id='chat'").first();
  if(adapterControl?.enabled!==1||gatewayControl?.enabled!==1||policy?.enabled!==1||request.signal.aborted)return await rejected(env,row);
  // Count the complete generation request, not character length. Keep reviewed
  // model-specific headroom; real preflight-vs-usage drift is an activation gate.
  const counted=await vendorCall(env,cfg.contract.methods.countTokens,{generateContentRequest:{model:'models/'+env.GEMINI_MODEL,...vendorBody}},remaining());
  if(!whole(counted.totalTokens,cfg.contract.limits.maxInputTokens)||counted.totalTokens+cfg.margin>row.input_limit)return await rejected(env,row);
  // Recheck stop controls after the network preflight and before billable dispatch.
  const currentAdapter=await env.ADAPTER_DB.prepare("SELECT enabled FROM gateway_control WHERE id='gateway'").first();
  const currentGateway=await env.GATEWAY_DB.prepare("SELECT enabled FROM gateway_control WHERE id='gateway'").first();
  const currentPolicy=await env.DB.prepare("SELECT enabled FROM chat_billing_policy WHERE id='chat'").first();
  const currentReservation=await env.DB.prepare("SELECT id FROM usage_reservations WHERE id=? AND status='reserved' AND provider_state='started' AND julianday(expires_at)>julianday('now')").bind(row.request_id).first();
  const currentClaim=await get(env,row.request_id);
  if(currentAdapter?.enabled!==1||currentGateway?.enabled!==1||currentPolicy?.enabled!==1||!currentReservation||currentClaim?.status!=='dispatching'||request.signal.aborted)return await rejected(env,row);
  const generationTimeout=remaining();dispatched=true;
  const result=await vendorCall(env,cfg.contract.methods.generateContent,vendorBody,generationTimeout),usage=result.usageMetadata;
  const accounting=cfg.contract.accounting;
  const prompt=usage?.[accounting.prompt],candidate=usage?.[accounting.candidate]??0,thoughts=usage?.[accounting.thoughts]??0,total=usage?.[accounting.total];
  if(typeof result.responseId!=='string'||!result.responseId||result.responseId.length>200||
   !whole(prompt,row.input_limit)||!whole(candidate,row.output_limit)||!whole(thoughts,row.output_limit)||candidate+thoughts>row.output_limit||
   !whole(total,cfg.contract.limits.maxTotalTokens)||total!==prompt+candidate+thoughts||(usage[accounting.cached]??0)!==0||(usage[accounting.tools]??0)!==0||
   prompt>counted.totalTokens+cfg.margin||!Array.isArray(result.candidates)||result.candidates.length>1)throw failure('ADAPTER_USAGE_CONTRACT_VIOLATION');
  const recordId='gemini_'+await hash(result.responseId);
  // Commit vendor evidence before constructing the reply. No prompt/output is
  // retained; a lost response can still reconcile measured candidate+thought use.
  await env.ADAPTER_DB.prepare(`INSERT INTO adapter_vendor_evidence (request_id,vendor_response_id,record_id,input_tokens,output_tokens,created_at)
   VALUES (?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(row.request_id,result.responseId,recordId,prompt,candidate+thoughts).run();
  const savedEvidence=await env.ADAPTER_DB.prepare('SELECT * FROM adapter_vendor_evidence WHERE request_id=?').bind(row.request_id).first();
  if(!savedEvidence||savedEvidence.record_id!==recordId)throw failure('ADAPTER_EVIDENCE_UNCONFIRMED');
  const receipt={protocol:'metered-v1',request_id:row.request_id,provider,model:row.model,id:recordId,status:'completed',billable:true,usage:{input_tokens:prompt,output_tokens:candidate+thoughts}};
  const saved=await finalize(state(env),row,receipt),parts=result.candidates[0]?.content?.parts;
  if(!Array.isArray(parts)||parts.some(part=>part.functionCall||part.inlineData||part.fileData))throw failure('ADAPTER_OUTPUT_UNAVAILABLE');
  const output=parts.filter(part=>!part.thought&&typeof part.text==='string').map(part=>part.text).join('');
  if(!output.trim()||output.length>32000)throw failure('ADAPTER_OUTPUT_UNAVAILABLE');
  return json({...envelope(saved),output});
 }catch(error){
  if(!dispatched)return await rejected(env,row);
  await unknown(state(env),row.request_id,error.code==='ADAPTER_USAGE_CONTRACT_VIOLATION'||error.code==='GATEWAY_INVALID_BODY'||error.message==='UPSTREAM_REDIRECT_BLOCKED');
  return json({code:'RECONCILIATION_REQUIRED',request_id:row.request_id},503);
 }
}
export default {
 async fetch(request,env){
  try{
   config(env);const path=new URL(request.url).pathname;
   if(path==='/responses'&&request.method==='POST'){
    if(!await authorized(request,env.ADAPTER_DISPATCH_KEY))throw failure('ADAPTER_UNAUTHORIZED',401);
    return await generate(request,env);
   }
   const id=/^\/receipts\/([A-Za-z0-9_-]{1,128})$/.exec(path)?.[1];
   if(id&&request.method==='GET'){
    if(!await authorized(request,env.ADAPTER_RECEIPT_KEY))throw failure('ADAPTER_UNAUTHORIZED',401);
    const receipt=await projectedReceipt(env,id);if(!receipt)throw failure('ADAPTER_RECEIPT_NOT_FOUND',404);return json(receipt);
   }
   return json({code:'ADAPTER_NOT_FOUND'},404);
  }catch(error){return json({code:error.code||'ADAPTER_UNAVAILABLE'},error.status||503);}
 }
};
