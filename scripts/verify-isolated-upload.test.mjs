import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {buildIsolatedStaging,fixtureBindings} from './prepare-isolated-staging.mjs';
import {validateUpload,schemaFingerprint,verifiedSchemaRows,validatePrivateSettings} from './deploy-isolated-staging.mjs';
const ids=['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'];
const names=['uvenaro-chat-staging','uvenaro-gateway-receipts-staging','uvenaro-adapter-evidence-staging'];
const record={protocol:'uvenaro-verified-isolated-databases-v1',accountId:'a'.repeat(32),databases:ids.map((uuid,i)=>({uuid,name:names[i],role:['billing','gateway-receipts','adapter-evidence'][i]}))};
const env={GITHUB_REPOSITORY:'Utkarsh-verma-sushama/toonverse-ai',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'b'.repeat(40),
 GITHUB_TOKEN:'fixture',CLOUDFLARE_API_TOKEN:'fixture',CLOUDFLARE_ACCOUNT_ID:record.accountId,UVENARO_STAGING_DATABASE_ID:fixtureBindings.UVENARO_STAGING_DATABASE_ID};
const request={protocol:'uvenaro-safe-off-staging-upload-v1',operationId:'fixture-owner-authorized-upload',sourceUploadAuthorized:true,providerCallsPermitted:false,
 allowedAction:'isolated-schemas-private-workers-and-temporary-authenticated-probe',repository:env.GITHUB_REPOSITORY,accountId:record.accountId,approvedAt:'2026-10-07T07:19:30Z',expiresAt:'2026-10-07T12:52:00Z'};
const now=Date.parse('2026-10-07T07:30:00Z');
test('explicit source approval resolves only the same account, first main push and owned distinct identities',()=>assert.deepEqual(validateUpload(request,record,env,now),ids));
for(const [name,change] of Object.entries({unapproved:{sourceUploadAuthorized:false},paid:{providerCallsPermitted:true},foreign:{accountId:'c'.repeat(32)},expired:{expiresAt:'2026-10-07T07:20:00Z'},future:{approvedAt:'2026-10-07T08:00:00Z'}}))test(name+' upload is blocked',()=>assert.throws(()=>validateUpload({...request,...change},record,env,now)));
test('rerun, pull request and pilot aliasing are blocked',()=>{
 for(const changed of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REF:'refs/pull/1/merge'},{GITHUB_EVENT_NAME:'pull_request'},{UVENARO_STAGING_DATABASE_ID:ids[0]}])assert.throws(()=>validateUpload(request,record,{...env,...changed},now));
 assert.throws(()=>validateUpload(request,{...record,databases:[record.databases[0],record.databases[0],record.databases[2]]},env,now));
});
test('schema fingerprint tolerates formatting but detects removed safety trigger or changed SQL',()=>{
 const source=[{type:'table',name:'x',tbl_name:'x',sql:'CREATE TABLE x (id TEXT)'},{type:'trigger',name:'guard',tbl_name:'x',sql:"CREATE TRIGGER guard BEFORE DELETE ON x BEGIN SELECT RAISE(ABORT,'immutable'); END"}];
 assert.equal(schemaFingerprint(source),schemaFingerprint([...source].reverse().map(o=>({...o,sql:o.sql.replaceAll(' ','\n  ')}))));
 assert.notEqual(schemaFingerprint(source),schemaFingerprint(source.slice(0,1)));
 assert.notEqual(schemaFingerprint(source),schemaFingerprint(source.map(o=>({...o,sql:o.sql.replace('immutable','mutable')}))));
 assert.throws(()=>schemaFingerprint([{type:'unknown'}]));
});
test('schema comparison ignores importer formatting/comments while preserving quoted literals',()=>{
 const object=sql=>[{type:'table',name:'x',tbl_name:'x',sql}];
 assert.equal(schemaFingerprint(object("CREATE TABLE x (id TEXT DEFAULT '-- literal')")),schemaFingerprint(object("create /* importer */ table x(id text default '-- literal') -- note\n")));
});
test('spaces and letter case inside SQL literals are safety-relevant and cannot be collapsed',()=>{
 const object=sql=>[{type:'table',name:'x',tbl_name:'x',sql}];
 assert.notEqual(schemaFingerprint(object("CREATE TABLE x(id TEXT DEFAULT 'one  two')")),schemaFingerprint(object("CREATE TABLE x(id TEXT DEFAULT 'one two')")));
 assert.notEqual(schemaFingerprint(object("CREATE TABLE x(id TEXT DEFAULT 'Private')")),schemaFingerprint(object("CREATE TABLE x(id TEXT DEFAULT 'private')")));
});
test('remote D1 response truncation, HTML and rejected results cannot become accepted schema',()=>{
 for(const value of [null,[],{},[{success:false,results:[]}],[{success:true,results:[]},{success:true,results:[]}]])assert.throws(()=>verifiedSchemaRows(value));
 assert.deepEqual(verifiedSchemaRows([{success:true,results:[]}]),[]);
});
test('final live settings require private endpoints, correct UUIDs, safe-off values, secrets and service identity',()=>{
 const config={vars:{GATEWAY_GENERATION_ENABLED:'false',GATEWAY_MODEL:''},d1_databases:[{binding:'DB',database_id:ids[0]}],services:[{binding:'PROVIDER_ADAPTER',service:'private-adapter'}]};
 const settings={observability:{enabled:false},bindings:[{name:'DB',type:'d1',id:ids[0]},{name:'GATEWAY_GENERATION_ENABLED',type:'plain_text',text:'false'},
  {name:'GATEWAY_MODEL',type:'plain_text',text:''},{name:'GATEWAY_DISPATCH_KEY',type:'secret_text'},{name:'PROVIDER_ADAPTER',type:'service',service:'private-adapter'}]},endpoint={enabled:false,previews_enabled:false};
 validatePrivateSettings(settings,endpoint,config,['GATEWAY_DISPATCH_KEY']);
 for(const changed of [{...endpoint,enabled:true},{...endpoint,previews_enabled:true},{}])assert.throws(()=>validatePrivateSettings(settings,changed,config,['GATEWAY_DISPATCH_KEY']));
 for(const changed of [{...settings,observability:{enabled:true}},{...settings,bindings:settings.bindings.filter(b=>b.type!=='secret_text')},
  {...settings,bindings:[...settings.bindings,{name:'GEMINI_API_KEY',type:'secret_text'}]},
  {...settings,bindings:settings.bindings.map(b=>b.name==='DB'?{...b,id:ids[1]}:b)}])assert.throws(()=>validatePrivateSettings(changed,endpoint,config,['GATEWAY_DISPATCH_KEY']));
});
function statements(source){
 const db=new DatabaseSync(':memory:'),queries=[];let pending='';
 try{for(const line of source.split('\n')){if(!line.trim()||line.trim().startsWith('--'))continue;pending+=line+'\n';if(!line.trim().endsWith(';'))continue;
  try{db.exec(pending);}catch(error){if(error.message.includes('incomplete input'))continue;throw error;}if(!pending.trim().startsWith('PRAGMA'))queries.push(pending);pending='';}
  assert.equal(pending,'');return queries;}finally{db.close();}
}
test('authenticated temporary probe proves secret isolation, zero generation, recovery and persistence on actual Workers',{timeout:45000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'uvenaro-upload-smoke-'));let mf,calls=0;
 try{
  const {manifest}=await buildIsolatedStaging(directory,{fixture:true}),key={GATEWAY_DISPATCH_KEY:'g'.repeat(43),GATEWAY_RECEIPT_KEY:'r'.repeat(43),ADAPTER_DISPATCH_KEY:'a'.repeat(43),ADAPTER_RECEIPT_KEY:'b'.repeat(43),PROBE_KEY:'p'.repeat(43)};
  const vars={...key,GATEWAY_ADAPTER_DISPATCH_KEY:key.ADAPTER_DISPATCH_KEY,GATEWAY_ADAPTER_RECEIPT_KEY:key.ADAPTER_RECEIPT_KEY,GATEWAY_PROVIDER:'google-gemini',GATEWAY_MODEL:'gemini-3.8-flash',GEMINI_MODEL:'gemini-3.8-flash',ENVIRONMENT:'staging',GATEWAY_ADAPTER_PROTOCOL:'bounded-metered-v1',GATEWAY_TIMEOUT_MS:'30000',FIXTURE_READ_ID:'fixture_read',FIXTURE_RECOVERY_ID:'fixture_recover'};
  const workers=[];
  for(const name of ['gateway','adapter']){const config=JSON.parse(await readFile(join(directory,name,'wrangler.json'),'utf8'));workers.push({name,modules:true,modulesRoot:directory,scriptPath:join(directory,name,'worker.mjs'),compatibilityDate:config.compatibility_date,
   bindings:{...config.vars,...vars},d1Databases:Object.fromEntries(config.d1_databases.map(d=>[d.binding,d.database_id])),outboundService:()=>{calls++;throw Error('External provider forbidden');}});}
  const compiled=await build({entryPoints:[new URL('../backend/isolated-staging-probe.mjs',import.meta.url).pathname],bundle:true,platform:'browser',format:'esm',write:false});
  workers.push({name:'probe',modules:true,script:compiled.outputFiles[0].text,bindings:vars,serviceBindings:{TARGET_GATEWAY:'gateway',TARGET_ADAPTER:'adapter'},d1Databases:{DB:fixtureBindings.UVENARO_CHAT_STAGING_DATABASE_ID,GATEWAY_DB:fixtureBindings.UVENARO_GATEWAY_STAGING_DATABASE_ID,ADAPTER_DB:fixtureBindings.UVENARO_ADAPTER_STAGING_DATABASE_ID}});
  const options={workers,d1Persist:join(directory,'state')};mf=new Miniflare(options);
  const dbs={billing:await mf.getD1Database('DB','probe'),gateway:await mf.getD1Database('GATEWAY_DB','probe'),adapter:await mf.getD1Database('ADAPTER_DB','probe')};
  for(const [role,db] of Object.entries(dbs)){const sql=(await Promise.all(Object.keys(manifest.files).filter(p=>p.startsWith(role+'/')&&p.endsWith('.sql')).sort().map(p=>readFile(join(directory,p),'utf8')))).join('\n');await db.batch(statements(sql).map(s=>db.prepare(s)));}
  for(const [role,db] of Object.entries(dbs).filter(([r])=>r!=='billing'))for(const id of [vars.FIXTURE_READ_ID,vars.FIXTURE_RECOVERY_ID]){
   await db.prepare("INSERT INTO gateway_receipts(request_id,request_hash,provider,model,input_limit,output_limit,status,created_at) VALUES(?,?,'google-gemini',?,100,50,'dispatching','fixture')").bind(id,'a'.repeat(64),vars.GATEWAY_MODEL).run();
   if(role==='adapter')await db.prepare('INSERT INTO adapter_vendor_evidence VALUES(?,?,?,?,?,?)').bind(id,'fixture-vendor-'+id,'gemini_'+(id===vars.FIXTURE_READ_ID?'c':'d').repeat(64),10,8,'fixture').run();
   await db.prepare("UPDATE gateway_receipts SET status='unknown' WHERE request_id=?").bind(id).run();
   if(role==='gateway'&&id===vars.FIXTURE_READ_ID)await db.prepare("UPDATE gateway_receipts SET status='completed',record_id=?,billable=1,input_tokens=10,output_tokens=8,finalized_at='fixture' WHERE request_id=?").bind('gemini_'+'c'.repeat(64),id).run();
  }
  async function smoke(){const probe=await mf.getWorker('probe');assert.equal((await probe.fetch('https://probe.invalid/smoke')).status,401);
   const response=await probe.fetch('https://probe.invalid/smoke',{headers:{authorization:'Bearer '+key.PROBE_KEY}});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).checks,19);}
  await smoke();await mf.dispose();mf=new Miniflare(options);await smoke();assert.equal(calls,0);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
