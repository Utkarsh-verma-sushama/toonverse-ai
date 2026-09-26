import {readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {buildStaging} from './prepare-account-staging.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function deploymentInputs(env){
 const names=['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','UVENARO_STAGING_DATABASE_ID','UVENARO_STAGING_ORIGIN','UVENARO_STAGING_ALLOWED_EMAILS','ACCOUNT_SESSION_KEY'];
 const missing=names.filter(n=>!env[n]);if(missing.length)throw new Error('Missing secure deployment settings: '+missing.join(', '));
 if(!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID))throw new Error('Invalid Cloudflare account ID');
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(env.UVENARO_STAGING_DATABASE_ID))throw new Error('Invalid staging database ID');
 let origin;try{origin=new URL(env.UVENARO_STAGING_ORIGIN);}catch{throw new Error('Invalid staging origin');}
 if(origin.protocol!=='https:'||origin.origin!==env.UVENARO_STAGING_ORIGIN||!/^uvenaro-account-staging\.[a-z0-9-]+\.workers\.dev$/.test(origin.hostname))throw new Error('Use the dedicated uvenaro-account-staging workers.dev origin');
 const emails=env.UVENARO_STAGING_ALLOWED_EMAILS.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(!emails.length||emails.length>20||emails.some(x=>x.length>254||!/^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/.test(x)))throw new Error('Use 1–20 explicit pilot email addresses');
 const key=env.ACCOUNT_SESSION_KEY;if(!/^[A-Za-z0-9_-]{43}$/.test(key)||Buffer.from(key,'base64url').length!==32||new Set(Buffer.from(key,'base64url')).size<16)throw new Error('ACCOUNT_SESSION_KEY must contain 32 random bytes in base64url');
 if(env.UVENARO_STAGING_ENABLE_AUTH&&!['true','false'].includes(env.UVENARO_STAGING_ENABLE_AUTH))throw new Error('Invalid authentication activation flag');
 return {accountId:env.CLOUDFLARE_ACCOUNT_ID,databaseId:env.UVENARO_STAGING_DATABASE_ID,origin:origin.origin,emails:emails.join(','),enabled:env.UVENARO_STAGING_ENABLE_AUTH==='true'};
}
export function requireStagingDatabase(info,expected){if(info?.name!=='uvenaro-account-staging'||(info.uuid||info.id)!==expected)throw new Error('Database identity mismatch. Refusing to migrate a different database.');}
export async function verifyRemoteDatabase(input,token,transport=fetch){
 const response=await transport(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/d1/database/${input.databaseId}`,{headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Staging database identity check failed');
 const payload=await response.json();if(payload.success!==true)throw new Error('Staging database identity check failed');requireStagingDatabase(payload.result,input.databaseId);
}
export function classifyRemoteFailure(text=''){
 const value=String(text).toLowerCase();
 if(/unauthori[sz]ed|forbidden|permission|authentication|code\s*[:=]?\s*10000|code\s*[:=]?\s*9109/.test(value))return 'permission/authentication';
 if(/already exists|duplicate column|duplicate|table .* exists|index .* exists|trigger .* exists/.test(value))return 'schema already exists / migration-state mismatch';
 if(/migration.*(?:state|history|applied|missing)|d1_migrations|no migrations to apply|migrations table/.test(value))return 'migration tracking/state';
 if(/timed? ?out|timeout|network|econn|enotfound|fetch failed|service unavailable|database unavailable/.test(value))return 'remote service/network';
 return 'unclassified remote failure';
}
export function safeWranglerFailure(phase,out={}){
 const raw=[out.error?.message,out.stderr,out.stdout].filter(Boolean).join('\n');
 const category=classifyRemoteFailure(raw);
 return new Error(`${phase} failed (${category}); raw provider output and credential values were suppressed.`);
}

const reconciliationFingerprints={
 '0001_atomic_chat_billing.sql':{
  columns:[
   ['provider_price_snapshots','valid_until'],
   ['usage_reservations','request_hash'],['usage_reservations','price_snapshot_id'],['usage_reservations','input_token_limit'],['usage_reservations','output_token_limit'],
   ['usage_reservations','input_tokens'],['usage_reservations','output_tokens'],['usage_reservations','global_cost_ceiling'],['usage_reservations','provider_state'],
   ['usage_reservations','provider_request_id'],['usage_reservations','failure_code'],['usage_reservations','expires_at']
  ],
  tables:['chat_billing_policy'],
  indexes:['idx_usage_active','idx_usage_time','idx_usage_settled_time','idx_usage_owner_settled','idx_chat_ledger_event'],
  triggers:['chat_reservation_guard','chat_reservation_hold','chat_reservation_transition','chat_reservation_finish','chat_reservation_no_delete','usage_ledger_no_update','usage_ledger_no_delete','price_snapshot_no_change','price_snapshot_no_delete','billing_account_guard']
 },
 '0002_account_sessions.sql':{
  tables:['account_profiles','account_sessions','account_access_tokens','account_refresh_tokens','account_security_events','account_rate_limits','account_challenges','account_deletion_requests'],
  indexes:['idx_account_sessions_owner','idx_account_access_expiry','idx_account_refresh_session','idx_account_security_owner','idx_account_rate_expiry','idx_account_deletion_pending'],
  triggers:['account_security_no_update']
 }
};
export function reconciliationDecision({pending=[],objects=[]}={}){
 const names=new Set(objects.map(x=>x?.name).filter(Boolean));
 const sqlByTable=new Map(objects.filter(x=>x?.type==='table'&&typeof x?.sql==='string').map(x=>[x.name,x.sql]));
 const decisions=[];
 for(const migration of pending){
  const fp=reconciliationFingerprints[migration];
  if(!fp){decisions.push({migration,action:'apply'});continue;}
  const expected=[...(fp.tables||[]),...(fp.indexes||[]),...(fp.triggers||[])],present=expected.filter(x=>names.has(x));
  const columns=fp.columns||[],presentColumns=columns.filter(([table,column])=>{
   const sql=sqlByTable.get(table);return typeof sql==='string'&&new RegExp('(?:^|[^A-Za-z0-9_])'+column+'(?:[^A-Za-z0-9_]|$)','i').test(sql);
  });
  const total=expected.length+columns.length,presentTotal=present.length+presentColumns.length;
  if(presentTotal===0){decisions.push({migration,action:'apply'});continue;}
  if(presentTotal!==total)throw new Error('Partial staging schema detected. Refusing automatic migration-state reconciliation.');
  decisions.push({migration,action:'reconcile'});
 }
 return decisions;
}

export function parseWranglerJson(text,phase='Remote D1 inspection'){
 let value;try{value=JSON.parse(String(text));}catch{throw new Error(`${phase} returned an unreadable response. Refusing reconciliation.`);}
 return value;
}
export function remoteSchemaInspectionSql(){
 return "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type,name;";
}
export function remoteMigrationHistorySql(){
 return "SELECT id,name,applied_at FROM d1_migrations ORDER BY id;";
}
export function remoteBaselineColumnsSql(){
 const tables=['billing_accounts','usage_reservations','usage_limits','usage_ledger','provider_price_snapshots'];
 return tables.map(t=>`SELECT '${t}' AS table_name,name,type,"notnull" AS not_null,pk FROM pragma_table_info('${t}')`).join(' UNION ALL ')+' ORDER BY table_name,name;';
}
export function expectedBaselineColumns(){
 return {
  billing_accounts:['owner_id','plan_id','status','included_credits','prepaid_credits','reserved_credits','cycle_started_at','cycle_ends_at','updated_at'],
  usage_reservations:['id','owner_id','idempotency_key','feature','estimated_credits','actual_credits','estimated_cost_microusd','actual_cost_microusd','status','created_at','settled_at'],
  usage_limits:['owner_id','daily_credit_limit','monthly_credit_limit','max_request_cost_microusd','requests_per_minute','blocked_until','updated_at'],
  usage_ledger:['id','owner_id','reservation_id','event_type','credits','cost_microusd','metadata_json','created_at'],
  provider_price_snapshots:['id','provider','model','input_microusd_per_million','output_microusd_per_million','credit_value_microusd','effective_at','retired_at']
 };
}
export function baselineColumnParity(rows=[]){
 const expected=expectedBaselineColumns(),actual={};
 for(const row of rows){if(typeof row?.table_name!=='string'||typeof row?.name!=='string')throw new Error('Remote baseline metadata is malformed. Refusing migration.');(actual[row.table_name]??=[]).push(row.name);}
 const mismatches=[];
 for(const [table,cols] of Object.entries(expected)){const got=actual[table]||[],missing=cols.filter(x=>!got.includes(x)),extra=got.filter(x=>!cols.includes(x));if(missing.length||extra.length)mismatches.push({table,missing,extra});}
 return mismatches;
}

export function wranglerRows(payload,phase='Remote D1 inspection'){
 if(!Array.isArray(payload)||payload.length!==1||payload[0]?.success!==true||!Array.isArray(payload[0]?.results))throw new Error(`${phase} returned an unexpected shape. Refusing reconciliation.`);
 return payload[0].results;
}
export function migrationHistoryNames(rows=[]){
 const names=[];
 for(const row of rows){
  if(!Number.isInteger(row?.id)||typeof row?.name!=='string'||!row.name.trim())throw new Error('Remote migration history is malformed. Refusing reconciliation.');
  names.push(row.name.trim());
 }
 if(new Set(names).size!==names.length)throw new Error('Remote migration history contains duplicate names. Refusing reconciliation.');
 return names;
}

export function pendingMigrationNames(localNames=[],appliedNames=[]){
 if(!Array.isArray(localNames)||!localNames.length||localNames.some(x=>typeof x!=='string'||!x.trim()))throw new Error('Local migration manifest is invalid. Refusing reconciliation.');
 const local=localNames.map(x=>x.trim()),applied=new Set(appliedNames);
 if(new Set(local).size!==local.length)throw new Error('Local migration manifest contains duplicate names. Refusing reconciliation.');
 for(const name of applied)if(!local.includes(name))throw new Error('Remote migration history contains an unknown migration. Refusing reconciliation.');
 let seenPending=false;
 for(const name of local){if(!applied.has(name))seenPending=true;else if(seenPending)throw new Error('Remote migration history is non-contiguous. Refusing reconciliation.');}
 return local.filter(name=>!applied.has(name));
}

export function safeTrackingReconciliationSql(decisions=[],localNames=[],appliedNames=[]){
 const reconcile=decisions.filter(x=>x.action==='reconcile').map(x=>x.migration);
 if(!reconcile.length)return null;
 const applied=new Set(appliedNames);
 for(const name of reconcile){
  if(!localNames.includes(name)||applied.has(name)||!/^[0-9]{4}_[A-Za-z0-9_.-]+\.sql$/.test(name))throw new Error('Unsafe migration reconciliation request. Refusing tracking mutation.');
 }
 const firstMissing=localNames.findIndex(x=>!applied.has(x));
 const expected=localNames.slice(firstMissing,firstMissing+reconcile.length);
 if(expected.length!==reconcile.length||expected.some((x,i)=>x!==reconcile[i]))throw new Error('Reconciliation is not a contiguous migration prefix. Refusing tracking mutation.');
 const q=s=>"'"+s.replaceAll("'","''")+"'";
 if(reconcile.length!==1)throw new Error('Remote migration tracking reconciliation must advance exactly one verified migration at a time.');
 return `INSERT INTO d1_migrations (name, applied_at) SELECT ${q(reconcile[0])}, datetime('now') WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name=${q(reconcile[0])});`;
}
async function main(){
 const remote=process.argv.includes('--remote');if(!remote){await buildStaging();console.log('Build only. Remote deployment requires --remote and configured credentials.');return;}
 const input=deploymentInputs(process.env);await buildStaging();
 const config=JSON.parse(await readFile(resolve(root,'deploy/account-staging/wrangler.json'),'utf8'));
 config.main='../backend/staging-worker.mjs';config.assets.directory='./public';config.account_id=input.accountId;config.d1_databases[0].database_id=input.databaseId;config.d1_databases[0].migrations_dir='./migrations';
 config.vars.STAGING_ORIGIN=input.origin;config.vars.STAGING_ALLOWED_EMAILS=input.emails;config.vars.ACCOUNT_AUTH_ENABLED=String(input.enabled);
 const publicContext={window:{}};vm.runInNewContext(await readFile(resolve(root,'assets/js/config.js'),'utf8'),publicContext);
 const firebase=publicContext.window.UvenaroConfig.firebase;if(firebase.projectId!=='toonverse-ai'||!firebase.apiKey)throw new Error('Firebase project configuration changed');
 const dir=resolve(root,'.account-staging');await mkdir(dir,{recursive:true,mode:0o700});const configPath=resolve(dir,'wrangler.json'),secretPath=resolve(dir,'deployment-secrets.json');await writeFile(configPath,JSON.stringify(config,null,2),{mode:0o600});
 function wrangler(args,phase,{safeDiagnostic=false}={}){
  const out=spawnSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--config',configPath],{cwd:root,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
  if(out.error||out.status!==0){
   if(safeDiagnostic){
    const raw=[out.stderr,out.stdout].filter(Boolean).join('\n');
    const migration=(raw.match(/(?:migration|file)\s+["'`]?([0-9]+_[A-Za-z0-9_.-]+\.sql)/i)||[])[1]||null;
    const sqlite=(raw.match(/(?:SQLITE_[A-Z_]+|D1_[A-Z_]+|duplicate column name|already exists|no such (?:table|column|index|trigger)|foreign key constraint failed|syntax error|near ["'`][^"'\n`]+["'`]:? syntax error)/i)||[])[0]||null;
    // Wrangler often wraps the useful SQLite reason after the generic SQLITE_ERROR token.
    // Emit only a tightly allow-listed, single-line reason; never raw output, SQL, paths, or credentials.
    const reasonPatterns=[
      /duplicate column name:\s*[A-Za-z_][A-Za-z0-9_]*/i,
      /(?:table|index|trigger)\s+[A-Za-z_][A-Za-z0-9_]*\s+already exists/i,
      /no such (?:table|column|index|trigger):\s*[A-Za-z_][A-Za-z0-9_.]*/i,
      /near ["'`][A-Za-z0-9_(),.+*\/-]{1,40}["'`]:\s*syntax error/i,
      /foreign key constraint failed/i,
      /not authorized/i
    ];
    const reason=reasonPatterns.map(pattern=>raw.match(pattern)?.[0]||null).find(Boolean)||null;
    const exitStatus=Number.isInteger(out.status)?out.status:null;
    const signal=typeof out.signal==='string'?out.signal:null;
    const stderrPresent=typeof out.stderr==='string'&&out.stderr.trim().length>0;
    const stdoutPresent=typeof out.stdout==='string'&&out.stdout.trim().length>0;
    console.error(JSON.stringify({migrationFailure:{phase,migration,errorClass:sqlite||classifyRemoteFailure(raw),reason,exitStatus,signal,stderrPresent,stdoutPresent}}));
   }
   throw safeWranglerFailure(phase,out);
  }return out.stdout;
 }
 await verifyRemoteDatabase(input,process.env.CLOUDFLARE_API_TOKEN);
 const schemaRaw=wrangler(['d1','execute','DB','--remote','--command',remoteSchemaInspectionSql(),'--json'],'Remote schema inspection');
 const schemaPayload=parseWranglerJson(schemaRaw,'Remote schema inspection');
 let schemaObjects=wranglerRows(schemaPayload,'Remote schema inspection');
 const historyRaw=wrangler(['d1','execute','DB','--remote','--command',remoteMigrationHistorySql(),'--json'],'Remote migration history inspection');
 const historyRows=wranglerRows(parseWranglerJson(historyRaw,'Remote migration history inspection'),'Remote migration history inspection');
 const appliedNames=migrationHistoryNames(historyRows);
 const localNames=(await readdir(resolve(dir,'migrations'))).filter(x=>/^\d+_.+\.sql$/.test(x)).sort();
 const pending=pendingMigrationNames(localNames,appliedNames);
 const decisions=reconciliationDecision({pending,objects:schemaObjects});
 console.log(JSON.stringify({migrationPreflight:{local:localNames,applied:appliedNames,pending,decisions,schemaObjects:schemaObjects.map(x=>({type:x.type,name:x.name,tbl_name:x.tbl_name}))}}));
 const reconciliationSql=safeTrackingReconciliationSql(decisions,localNames,appliedNames);
 if(reconciliationSql){
  wrangler(['d1','execute','DB','--remote','--command',reconciliationSql],'Remote migration tracking reconciliation');
  const verifyRaw=wrangler(['d1','execute','DB','--remote','--command',remoteMigrationHistorySql(),'--json'],'Post-reconciliation history verification');
  const verified=migrationHistoryNames(wranglerRows(parseWranglerJson(verifyRaw,'Post-reconciliation history verification'),'Post-reconciliation history verification'));
  pendingMigrationNames(localNames,verified);
 }
 const baselineRaw=wrangler(['d1','execute','DB','--remote','--command',remoteBaselineColumnsSql(),'--json'],'Remote baseline structural inspection');
 const baselineRows=wranglerRows(parseWranglerJson(baselineRaw,'Remote baseline structural inspection'),'Remote baseline structural inspection');
 const baselineMismatches=baselineColumnParity(baselineRows);
 console.log(JSON.stringify({baselineParity:{matched:baselineMismatches.length===0,mismatches:baselineMismatches}}));
 if(baselineMismatches.length)throw new Error('Remote staging baseline differs from the current baseline. Refusing tracked migration until drift is resolved.');
 wrangler(['d1','migrations','list','DB','--remote'],'Remote migration preflight');
 // Remote D1's /query migration splitter has known trigger-body parsing defects. Apply each
 // reviewed SQL file through D1's file-import path, then verify the complete fingerprint
 // before recording migration history. Never mark an unverified or partial migration applied.
 let trackedApplied=[...appliedNames];
 for(const migration of pending){
  const initialDecision=reconciliationDecision({pending:[migration],objects:schemaObjects})[0];
  if(initialDecision?.action==='apply'){
   const migrationPath=resolve(dir,'migrations',migration);
   wrangler(['d1','execute','DB','--remote','--file',migrationPath],`Remote migration file import ${migration}`,{safeDiagnostic:true});
  }
  const verifySchemaRaw=wrangler(['d1','execute','DB','--remote','--command',remoteSchemaInspectionSql(),'--json'],`Post-import schema verification ${migration}`);
  const verifyObjects=wranglerRows(parseWranglerJson(verifySchemaRaw,`Post-import schema verification ${migration}`),`Post-import schema verification ${migration}`);
  const verifiedDecision=reconciliationDecision({pending:[migration],objects:verifyObjects})[0];
  if(verifiedDecision?.action!=='reconcile')throw new Error('Remote migration import did not produce the complete expected schema. Refusing tracking mutation.');
  const trackingSql=safeTrackingReconciliationSql([{migration,action:'reconcile'}],localNames,trackedApplied);
  if(!trackingSql)throw new Error('Expected a verified migration tracking mutation.');
  wrangler(['d1','execute','DB','--remote','--command',trackingSql],`Verified migration tracking ${migration}`);
  const verifyHistoryRaw=wrangler(['d1','execute','DB','--remote','--command',remoteMigrationHistorySql(),'--json'],`Post-tracking history verification ${migration}`);
  const verifiedHistory=migrationHistoryNames(wranglerRows(parseWranglerJson(verifyHistoryRaw,`Post-tracking history verification ${migration}`),`Post-tracking history verification ${migration}`));
  const expectedTracked=[...trackedApplied,migration];
  if(verifiedHistory.length!==expectedTracked.length||verifiedHistory.some((name,index)=>name!==expectedTracked[index]))throw new Error('Remote migration history did not exactly match the verified contiguous state. Refusing to continue.');
  trackedApplied=verifiedHistory;
  pendingMigrationNames(localNames,trackedApplied);
  schemaObjects=verifyObjects;
 }
 try{await writeFile(secretPath,JSON.stringify({ACCOUNT_SESSION_KEY:process.env.ACCOUNT_SESSION_KEY,FIREBASE_WEB_API_KEY:firebase.apiKey}),{mode:0o600});wrangler(['deploy','--secrets-file',secretPath],'Account staging deployment');}finally{await rm(secretPath,{force:true});}
 let health=null,lastHealthFailure='unavailable';
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const response=await fetch(input.origin+'/api/v1/health',{redirect:'error',signal:AbortSignal.timeout(15000)});
   const contentType=response.headers.get('content-type')||'',body=await response.text();
   if(!response.ok){lastHealthFailure='http '+response.status;}
   else if(!/application\/json/i.test(contentType)){lastHealthFailure='non-json response';}
   else{
    try{health=JSON.parse(body);}catch{lastHealthFailure='invalid json response';}
    if(health&&health.service==='uvenaro-account-staging'&&health.accountReady===input.enabled)break;
    if(health)lastHealthFailure='health payload mismatch';
   }
  }catch(error){lastHealthFailure=error?.name==='TimeoutError'?'timeout':'network failure';}
  if(attempt<3)await new Promise(resolve=>setTimeout(resolve,2000*attempt));
 }
 if(!health||health.service!=='uvenaro-account-staging'||health.accountReady!==input.enabled)throw new Error(`Deployment health verification failed after retries (${lastHealthFailure}); response bodies were suppressed.`);
 console.log(JSON.stringify({deployed:true,url:input.origin+'/account.html',accountReady:health.accountReady,providerChecked:false}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
