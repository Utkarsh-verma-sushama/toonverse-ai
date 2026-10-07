import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fixture,d1,alice,cfg,messages,invariant} from './billing-fixtures.mjs';
import {reserveChat,beginDispatch} from '../backend/chat-billing.mjs';
export const gatewaySchema=readFileSync(new URL('../backend/gateway/schema.sql',import.meta.url),'utf8');
export const dispatchKey='d'.repeat(43),receiptKey='r'.repeat(43);
export async function gatewayFixture(run){
 const db=fixture(),gatewaySql=new DatabaseSync(':memory:');gatewaySql.exec(gatewaySchema);
 gatewaySql.exec("UPDATE gateway_control SET enabled=1 WHERE id='gateway'");
 try{
  const row=await reserveChat(db,alice,'gateway-server',messages,cfg);await beginDispatch(db,alice,row);
  const body={protocol:'metered-v1',request_id:row.id,model:cfg.model,messages,max_input_tokens:100,max_output_tokens:50,tools:[],store:false};
  const completed={protocol:'metered-v1',request_id:row.id,provider:cfg.provider,model:cfg.model,id:'vendor-record-1',status:'completed',billable:true,output:'Verified answer',usage:{input_tokens:10,output_tokens:5}};
  const calls=[];
  const env={...db,GATEWAY_DB:d1(gatewaySql),ENVIRONMENT:'production',GATEWAY_PROVIDER:cfg.provider,GATEWAY_MODEL:cfg.model,
   GATEWAY_DISPATCH_KEY:dispatchKey,GATEWAY_RECEIPT_KEY:receiptKey,GATEWAY_GENERATION_ENABLED:'true',GATEWAY_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_GATEWAY',
   GATEWAY_ADAPTER_PROTOCOL:'bounded-metered-v1',GATEWAY_PROVIDER_ADAPTER_AUDITED:'true',GATEWAY_RECOVERY_ENABLED:'true',GATEWAY_RECOVERY_CONFIRMATION:'UVENARO_RECOVER_GATEWAY_RECEIPTS',
   PROVIDER_ADAPTER:{async fetch(request){calls.push({method:request.method,url:request.url,body:request.method==='POST'?await request.json():null});return Response.json(completed);}}};
  const request=(value=body,key=dispatchKey)=>new Request('https://gateway.invalid/responses',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','idempotency-key':value.request_id},body:JSON.stringify(value)});
  const readRequest=(key=receiptKey)=>new Request('https://gateway.invalid/receipts/'+row.id,{headers:{authorization:'Bearer '+key}});
  await run({db,gatewaySql,env,row,body,completed,calls,request,readRequest});invariant(db);
 }finally{db.sql.close();gatewaySql.close();}
}
