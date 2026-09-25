import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
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
 '0002_account_sessions.sql':{
  tables:['account_profiles','account_sessions','account_access_tokens','account_refresh_tokens','account_security_events','account_rate_limits','account_challenges','account_deletion_requests'],
  indexes:['idx_account_sessions_owner','idx_account_access_expiry','idx_account_refresh_session','idx_account_security_owner','idx_account_rate_expiry','idx_account_deletion_pending'],
  triggers:['account_security_no_update']
 }
};
export function reconciliationDecision({pending=[],objects=[]}={}){
 const names=new Set(objects.map(x=>x?.name).filter(Boolean));
 const decisions=[];
 for(const migration of pending){
  const fp=reconciliationFingerprints[migration];
  if(!fp){decisions.push({migration,action:'apply'});continue;}
  const expected=[...fp.tables,...fp.indexes,...fp.triggers],present=expected.filter(x=>names.has(x));
  if(present.length===0){decisions.push({migration,action:'apply'});continue;}
  if(present.length!==expected.length)throw new Error('Partial staging schema detected. Refusing automatic migration-state reconciliation.');
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
async function main(){
 const remote=process.argv.includes('--remote');if(!remote){await buildStaging();console.log('Build only. Remote deployment requires --remote and configured credentials.');return;}
 const input=deploymentInputs(process.env);await buildStaging();
 const config=JSON.parse(await readFile(resolve(root,'deploy/account-staging/wrangler.json'),'utf8'));
 config.main='../backend/staging-worker.mjs';config.assets.directory='./public';config.account_id=input.accountId;config.d1_databases[0].database_id=input.databaseId;config.d1_databases[0].migrations_dir='./migrations';
 config.vars.STAGING_ORIGIN=input.origin;config.vars.STAGING_ALLOWED_EMAILS=input.emails;config.vars.ACCOUNT_AUTH_ENABLED=String(input.enabled);
 const publicContext={window:{}};vm.runInNewContext(await readFile(resolve(root,'assets/js/config.js'),'utf8'),publicContext);
 const firebase=publicContext.window.UvenaroConfig.firebase;if(firebase.projectId!=='toonverse-ai'||!firebase.apiKey)throw new Error('Firebase project configuration changed');
 const dir=resolve(root,'.account-staging');await mkdir(dir,{recursive:true,mode:0o700});const configPath=resolve(dir,'wrangler.json'),secretPath=resolve(dir,'deployment-secrets.json');await writeFile(configPath,JSON.stringify(config,null,2),{mode:0o600});
 function wrangler(args,phase){
  const out=spawnSync(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),...args,'--config',configPath],{cwd:root,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
  if(out.error||out.status!==0)throw safeWranglerFailure(phase,out);return out.stdout;
 }
 await verifyRemoteDatabase(input,process.env.CLOUDFLARE_API_TOKEN);
 const schemaRaw=wrangler(['d1','execute','DB','--remote','--command',remoteSchemaInspectionSql(),'--json'],'Remote schema inspection');
 const schemaPayload=parseWranglerJson(schemaRaw,'Remote schema inspection');
 const schemaObjects=wranglerRows(schemaPayload,'Remote schema inspection');
 const historyRaw=wrangler(['d1','execute','DB','--remote','--command',remoteMigrationHistorySql(),'--json'],'Remote migration history inspection');
 const historyRows=wranglerRows(parseWranglerJson(historyRaw,'Remote migration history inspection'),'Remote migration history inspection');
 const appliedNames=migrationHistoryNames(historyRows);
 const localNames=(await readFile(resolve(dir,'migrations'),'utf8').catch(()=>null))===null
  ? (await import('node:fs/promises')).readdir(resolve(dir,'migrations')).then(xs=>xs.filter(x=>/^\\d+_.+\\.sql$/.test(x)).sort())
  : [];
 const pending= pendingMigrationNames(await localNames,appliedNames);
 const decisions=reconciliationDecision({pending,objects:schemaObjects});
 if(decisions.some(x=>x.action==='reconcile'))throw new Error('Verified schema/history mismatch requires explicit safe tracking reconciliation before migration apply.');
 wrangler(['d1','migrations','list','DB','--remote'],'Remote migration preflight');
 wrangler(['d1','migrations','apply','DB','--remote'],'Tracked database migration');
 try{await writeFile(secretPath,JSON.stringify({ACCOUNT_SESSION_KEY:process.env.ACCOUNT_SESSION_KEY,FIREBASE_WEB_API_KEY:firebase.apiKey}),{mode:0o600});wrangler(['deploy','--secrets-file',secretPath],'Account staging deployment');}finally{await rm(secretPath,{force:true});}
 const response=await fetch(input.origin+'/api/v1/health',{redirect:'error',signal:AbortSignal.timeout(15000)}),health=await response.json();
 if(!response.ok||health.service!=='uvenaro-account-staging'||health.accountReady!==input.enabled)throw new Error('Deployment health check did not match requested activation. Inspect staging before use.');
 console.log(JSON.stringify({deployed:true,url:input.origin+'/account.html',accountReady:health.accountReady,providerChecked:false}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
