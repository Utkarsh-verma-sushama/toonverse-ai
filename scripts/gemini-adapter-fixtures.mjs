import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fixture,d1,alice,messages,invariant} from './billing-fixtures.mjs';
import {reserveChat,beginDispatch} from '../backend/chat-billing.mjs';
import {gatewaySchema} from './gateway-fixtures.mjs';
export const adapterSchema=readFileSync(new URL('../backend/gemini-adapter/schema.sql',import.meta.url),'utf8');
export const adapterDispatch='a'.repeat(43),adapterRead='b'.repeat(43),model='gemini-3.8-flash';
export async function adapterFixture(run){
 const db=fixture(),gatewaySql=new DatabaseSync(':memory:'),adapterSql=new DatabaseSync(':memory:');
 gatewaySql.exec(gatewaySchema);adapterSql.exec(gatewaySchema+adapterSchema);
 gatewaySql.exec("UPDATE gateway_control SET enabled=1");adapterSql.exec("UPDATE gateway_control SET enabled=1");
 const oldFetch=globalThis.fetch;
 try{
  db.sql.prepare('INSERT INTO provider_price_snapshots (id,provider,model,input_microusd_per_million,output_microusd_per_million,credit_value_microusd,effective_at,retired_at,valid_until) VALUES (?,?,?,?,?,?,?,?,?)')
   .run('gemini-price','google-gemini',model,1000000,1000000,10,new Date(Date.now()-86400000).toISOString(),null,new Date(Date.now()+86400000).toISOString());
  const cfg={provider:'google-gemini',model,maxInputTokens:100,maxOutputTokens:50,globalCeiling:100000};
  const row=await reserveChat(db,alice,'gemini-adapter',messages,cfg);await beginDispatch(db,alice,row);
  gatewaySql.prepare("INSERT INTO gateway_receipts (request_id,request_hash,provider,model,input_limit,output_limit,status,created_at) VALUES (?,?,?,?,?,?,'dispatching',?)")
   .run(row.id,row.request_hash,cfg.provider,model,100,50,new Date().toISOString());
  const body={protocol:'metered-v1',request_id:row.id,provider:cfg.provider,model,messages,max_input_tokens:100,max_output_tokens:50,tools:[],store:false};
  const env={...db,GATEWAY_DB:d1(gatewaySql),ADAPTER_DB:d1(adapterSql),ENVIRONMENT:'production',GEMINI_MODEL:model,ADAPTER_DISPATCH_KEY:adapterDispatch,ADAPTER_RECEIPT_KEY:adapterRead,
   GEMINI_GENERATION_ENABLED:'true',GEMINI_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_GEMINI_GENERATION',GEMINI_MODEL_PROFILE_AUDITED:'true',GEMINI_PREFLIGHT_AUDITED:'true',
   GEMINI_COUNT_TOKENS_NONBILLABLE_AUDITED:'true',GEMINI_PRIVACY_PRICING_AUDITED:'true',GEMINI_API_KEY:'fixture-google-key',GEMINI_PREFLIGHT_TOKEN_MARGIN:'16'};
  const vendor={responseId:'vendor-response-1',modelVersion:model,candidates:[{content:{parts:[{text:'Bounded Google answer'}]},finishReason:'STOP'}],
   usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,thoughtsTokenCount:3,totalTokenCount:18}};
  const calls=[];globalThis.fetch=async(url,options)=>{
   calls.push({url:String(url),options});assertPrivate(url,options);
   return Response.json(String(url).endsWith(':countTokens')?{totalTokens:10}:vendor);
  };
  const request=(value=body,key=adapterDispatch)=>new Request('https://adapter.internal/responses',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(value)});
  const readRequest=(key=adapterRead)=>new Request('https://adapter.internal/receipts/'+row.id,{headers:{authorization:'Bearer '+key}});
  await run({db,gatewaySql,adapterSql,env,row,body,vendor,calls,request,readRequest});invariant(db);
 }finally{globalThis.fetch=oldFetch;db.sql.close();gatewaySql.close();adapterSql.close();}
}
function assertPrivate(url,options){
 if(!String(url).startsWith('https://generativelanguage.googleapis.com/v1beta/models/')||String(url).includes('fixture-google-key')||options.headers['x-goog-api-key']!=='fixture-google-key'||options.redirect!=='manual')throw Error('Fixture transport contract');
}
