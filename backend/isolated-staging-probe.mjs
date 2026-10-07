import {authorized,json,recoverGatewayReceipt} from './metered-gateway.mjs';
// Temporary authenticated operator probe. Fixed services and fixture identities;
// no user-selected URL, generation switch, provider key, scheduler or public data.
export default {async fetch(request,env){
 if(!await authorized(request,env.PROBE_KEY))return json({code:'PROBE_UNAUTHORIZED'},401);
 const path=new URL(request.url).pathname;
 if(request.method!=='GET'||!['/smoke','/final'].includes(path))return json({code:'PROBE_NOT_FOUND'},404);
 let checks=0;
 try{
  const require=value=>{if(!value)throw Error('PROBE_ASSERTION_FAILED');checks++;};
  const targets=[['gateway',env.TARGET_GATEWAY,env.GATEWAY_DISPATCH_KEY,env.GATEWAY_RECEIPT_KEY],
   ['adapter',env.TARGET_ADAPTER,env.ADAPTER_DISPATCH_KEY,env.ADAPTER_RECEIPT_KEY]];
  for(const [name,worker,dispatch,receipt] of targets){
   const call=(url,key,method='GET')=>worker.fetch('https://private.internal'+url,{method,headers:{authorization:'Bearer '+key}});
   if(path==='/final'){
    require((await call('/responses',dispatch,'POST')).status===503);
    require((await call('/receipts/'+env.FIXTURE_READ_ID,receipt)).status===503);
    continue;
   }
   require((await call('/responses',receipt,'POST')).status===401);
   require((await call('/responses',dispatch,'POST')).status===503);
   require((await call('/receipts/'+env.FIXTURE_READ_ID,dispatch)).status===401);
   require((await call('/receipts/'+env.FIXTURE_READ_ID,'invalid')).status===401);
   const response=await call('/receipts/'+env.FIXTURE_READ_ID,receipt),body=await response.json();
   require(response.status===200&&body.status==='completed'&&body.usage?.input_tokens===10&&body.usage?.output_tokens===8&&body.output===undefined);
   const foreign=name==='gateway'?env.ADAPTER_RECEIPT_KEY:env.GATEWAY_RECEIPT_KEY;
   require((await call('/receipts/'+env.FIXTURE_READ_ID,foreign)).status===401);
  }
  if(path==='/smoke'){
   const recovery={...env,GATEWAY_RECOVERY_ENABLED:'true',PROVIDER_ADAPTER:env.TARGET_ADAPTER};
   const recovered=await recoverGatewayReceipt(recovery,env.FIXTURE_RECOVERY_ID);
   require(recovered.status==='completed'&&recovered.usage.input_tokens===10&&recovered.usage.output_tokens===8);
   const repeated=await recoverGatewayReceipt(recovery,env.FIXTURE_RECOVERY_ID);
   require(JSON.stringify(recovered)===JSON.stringify(repeated));
   const source=await env.ADAPTER_DB.prepare('SELECT status FROM gateway_receipts WHERE request_id=?').bind(env.FIXTURE_RECOVERY_ID).first();
   require(source?.status==='unknown');
  }
  const usage=await env.DB.prepare('SELECT COUNT(*) AS n FROM usage_reservations').first();require(usage?.n===0);
  for(const db of [env.GATEWAY_DB,env.ADAPTER_DB])require((await db.prepare("SELECT enabled FROM gateway_control WHERE id='gateway'").first())?.enabled===0);
  const policy=await env.DB.prepare("SELECT enabled FROM chat_billing_policy WHERE id='chat'").first();
  require(policy===null||policy?.enabled===0);
  return json({ok:true,phase:path.slice(1),checks,providerRequestsPerformed:false});
 }catch(error){return json({code:'PROBE_ACCEPTANCE_FAILED',checksPassed:checks,reason:/^[A-Z_]+$/.test(error.code||'')?error.code:'ASSERTION_OR_DATABASE_FAILURE'},503);}
}};
