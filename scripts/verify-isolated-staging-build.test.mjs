import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {buildIsolatedStaging,isolatedBindings,fixtureBindings} from './prepare-isolated-staging.mjs';
const valid={UVENARO_STAGING_DATABASE_ID:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',UVENARO_CHAT_STAGING_DATABASE_ID:'44444444-4444-4444-8444-444444444444',UVENARO_GATEWAY_STAGING_DATABASE_ID:'55555555-5555-4555-8555-555555555555',UVENARO_ADAPTER_STAGING_DATABASE_ID:'66666666-6666-4666-8666-666666666666'};
for(const [name,env] of Object.entries({missing:{},pilotAlias:{...valid,UVENARO_CHAT_STAGING_DATABASE_ID:valid.UVENARO_STAGING_DATABASE_ID},duplicate:{...valid,UVENARO_GATEWAY_STAGING_DATABASE_ID:valid.UVENARO_CHAT_STAGING_DATABASE_ID},fixtures:fixtureBindings}))test(name+' bindings cannot become a remote configuration',()=>assert.throws(()=>isolatedBindings(env)));
test('concrete isolated database bindings are accepted without creating resources',()=>assert.equal(isolatedBindings(valid).length,3));
function statements(source){
 const parser=new DatabaseSync(':memory:'),queries=[];let pending='';
 try{for(const line of source.split('\n')){
  if(!line.trim()||line.trim().startsWith('--'))continue;pending+=line+'\n';if(!line.trim().endsWith(';'))continue;
  try{parser.exec(pending);}catch(error){if(error.message.includes('incomplete input'))continue;throw error;}
  if(!pending.trim().startsWith('PRAGMA'))queries.push(pending);pending='';
 }assert.equal(pending,'');return queries;}finally{parser.close();}
}
test('prepared deployment artifacts keep activation off and fingerprint the complete schema chain',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'uvenaro-stage-bundle-'));
 try{
  const {manifest}=await buildIsolatedStaging(directory,{env:valid});
  assert.equal(manifest.remoteDeploymentAuthorized,false);assert.equal(manifest.providerCallsPermitted,false);assert.equal(manifest.fixtureOnly,false);
  assert.equal(Object.keys(manifest.files).filter(p=>p.startsWith('billing/')).length,8);
  for(const [path,hash] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(await readFile(join(directory,path))).digest('hex'),hash);
  for(const name of ['gateway','adapter']){
   const config=JSON.parse(await readFile(join(directory,name,'wrangler.json'),'utf8'));
   assert.equal(config.main,'worker.mjs');assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
   for(const [key,value] of Object.entries(config.vars))if(/_ENABLED$|_AUDITED$/.test(key))assert.equal(value,'false');
   assert.equal(config.d1_databases[0].database_id,valid.UVENARO_CHAT_STAGING_DATABASE_ID);
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('bundled safe-off Workers and exact full migration artifacts preserve scoped receipts through restart',{timeout:30000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'uvenaro-stage-smoke-'));let mf,calls=0;
 try{
  const {manifest}=await buildIsolatedStaging(directory,{fixture:true});const key='d'.repeat(43),readKey='r'.repeat(43),model='gemini-3.8-flash';
  const workers=await Promise.all(['gateway','adapter'].map(async name=>{
   const config=JSON.parse(await readFile(join(directory,name,'wrangler.json'),'utf8'));
   return {name,modules:true,modulesRoot:directory,scriptPath:join(directory,name,'worker.mjs'),compatibilityDate:config.compatibility_date,
    d1Databases:Object.fromEntries(config.d1_databases.map(db=>[db.binding,db.database_id])),
    bindings:{...config.vars,GATEWAY_PROVIDER:'google-gemini',GATEWAY_MODEL:model,GEMINI_MODEL:model,GATEWAY_DISPATCH_KEY:key,GATEWAY_RECEIPT_KEY:readKey,ADAPTER_DISPATCH_KEY:key,ADAPTER_RECEIPT_KEY:readKey},
    outboundService:()=>{calls++;throw Error('No external request permitted during safe-off smoke');}};
  }));
  const options={workers,d1Persist:join(directory,'d1')};mf=new Miniflare(options);
  const billing=await mf.getD1Database('DB','gateway'),gateway=await mf.getD1Database('GATEWAY_DB','gateway'),adapter=await mf.getD1Database('ADAPTER_DB','adapter');
  for(const [role,db] of [['billing',billing],['gateway',gateway],['adapter',adapter]]){
   const sql=(await Promise.all(Object.keys(manifest.files).filter(p=>p.startsWith(role+'/')&&p.endsWith('.sql')).sort().map(p=>readFile(join(directory,p),'utf8')))).join('\n');
   assert.equal(sql.includes('\r'),false);await db.batch(statements(sql).map(q=>db.prepare(q)));
  }
  const id='isolated-fixture-safe-off',record='gemini_'+'c'.repeat(64);
  for(const db of [gateway,adapter])await db.prepare("INSERT INTO gateway_receipts (request_id,request_hash,provider,model,input_limit,output_limit,status,created_at) VALUES (?,?,'google-gemini',?,100,50,'dispatching','fixture')").bind(id,'a'.repeat(64),model).run();
  await adapter.prepare("INSERT INTO adapter_vendor_evidence VALUES (?,?,?,?,?,?)").bind(id,'fixture-response',record,10,8,'fixture').run();
  await adapter.prepare("UPDATE gateway_receipts SET status='unknown' WHERE request_id=?").bind(id).run();
  await gateway.prepare("UPDATE gateway_receipts SET status='completed',record_id=?,billable=1,input_tokens=10,output_tokens=8,finalized_at='fixture' WHERE request_id=?").bind(record,id).run();
  async function smoke(){
   for(const name of ['gateway','adapter']){
    const worker=await mf.getWorker(name);
    assert.equal((await worker.fetch('https://stage.invalid/responses',{method:'POST',headers:{authorization:'Bearer '+readKey}})).status,401);
    assert.equal((await worker.fetch('https://stage.invalid/responses',{method:'POST',headers:{authorization:'Bearer '+key}})).status,503);
    assert.equal((await worker.fetch('https://stage.invalid/receipts/'+id,{headers:{authorization:'Bearer '+key}})).status,401);
    const response=await worker.fetch('https://stage.invalid/receipts/'+id,{headers:{authorization:'Bearer '+readKey}});
    assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.status,'completed');assert.equal(receipt.usage.output_tokens,8);assert.equal(receipt.output,undefined);
   }
  }
  await smoke();await mf.dispose();mf=new Miniflare(options);await smoke();assert.equal(calls,0);
  const after=await mf.getD1Database('ADAPTER_DB','adapter');assert.equal((await after.prepare('SELECT status FROM gateway_receipts').first()).status,'unknown');
  const billingAfter=await mf.getD1Database('DB','gateway');assert.equal((await billingAfter.prepare('SELECT COUNT(*) AS n FROM usage_reservations').first()).n,0);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
