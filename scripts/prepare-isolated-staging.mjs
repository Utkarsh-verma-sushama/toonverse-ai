import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url));
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fields=['UVENARO_CHAT_STAGING_DATABASE_ID','UVENARO_GATEWAY_STAGING_DATABASE_ID','UVENARO_ADAPTER_STAGING_DATABASE_ID'];
export const fixtureBindings=Object.freeze({UVENARO_STAGING_DATABASE_ID:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
 UVENARO_CHAT_STAGING_DATABASE_ID:'11111111-1111-4111-8111-111111111111',UVENARO_GATEWAY_STAGING_DATABASE_ID:'22222222-2222-4222-8222-222222222222',UVENARO_ADAPTER_STAGING_DATABASE_ID:'33333333-3333-4333-8333-333333333333'});
export function isolatedBindings(env){
 const pilot=env.UVENARO_STAGING_DATABASE_ID,ids=fields.map(name=>env[name]);
 if(!uuid.test(pilot||'')||ids.some(id=>!uuid.test(id||'')))throw Error('ISOLATED_STAGING_BINDINGS_REQUIRED');
 if(new Set(ids).size!==3||ids.includes(pilot))throw Error('ISOLATED_STAGING_DATABASE_ALIAS');
 if(Object.values(fixtureBindings).some(id=>ids.includes(id)))throw Error('FIXTURE_BINDINGS_ARE_NOT_REMOTE_BINDINGS');
 return ids;
}
export async function buildIsolatedStaging(destination=resolve(root,'.isolated-staging'),{env=process.env,fixture=false}={}){
 const ids=fixture?fields.map(name=>fixtureBindings[name]):isolatedBindings(env),base=resolve(destination),files=[];
 async function put(path,content){const full=resolve(base,path);await mkdir(resolve(full,'..'),{recursive:true});await writeFile(full,content);files.push(path);}
 async function sql(source,path){const data=(await readFile(resolve(root,source),'utf8')).replace(/\r\n?/g,'\n');await put(path,data.endsWith('\n')?data:data+'\n');}
 await sql('backend/schema.sql','billing/0000_baseline.sql');
 for(const file of (await readdir(resolve(root,'backend/migrations'))).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort())await sql('backend/migrations/'+file,'billing/'+file);
 await sql('backend/gateway/schema.sql','gateway/0000_receipts.sql');
 await sql('backend/gateway/schema.sql','adapter/0000_receipts.sql');await sql('backend/gemini-adapter/schema.sql','adapter/0001_vendor_evidence.sql');
 for(const [name,source] of [['gateway','deploy/metered-gateway/wrangler.json'],['adapter','deploy/gemini-adapter/wrangler.json']]){
  const config=JSON.parse(await readFile(resolve(root,source),'utf8'));
  if(config.workers_dev!==false||config.preview_urls!==false||config.routes||config.triggers||config.vars.ENVIRONMENT!=='staging')throw Error('UNSAFE_STAGING_CONFIGURATION');
  if(Object.entries(config.vars).some(([key,value])=>(/_ENABLED$|_AUDITED$/.test(key)&&value!=='false')||(/_CONFIRMATION$/.test(key)&&value!=='')))throw Error('UNSAFE_STAGING_ACTIVATION');
  if(Object.entries(config.vars).some(([key,value])=>/_KEY$|_TOKEN$|_SECRET$/.test(key)&&value))throw Error('STAGING_SECRETS_IN_SOURCE');
  const bindings={DB:ids[0],GATEWAY_DB:ids[1],ADAPTER_DB:ids[2]};
  for(const db of config.d1_databases){if(!bindings[db.binding])throw Error('UNKNOWN_STAGING_BINDING');db.database_id=bindings[db.binding];}
  const compiled=await build({entryPoints:[resolve(dirname(resolve(root,source)),config.main)],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
  await put(name+'/worker.mjs',compiled.outputFiles[0].contents);config.main='worker.mjs';await put(name+'/wrangler.json',JSON.stringify(config,null,2)+'\n');
 }
 const hashes={};for(const file of files)hashes[file]=createHash('sha256').update(await readFile(resolve(base,file))).digest('hex');
 const manifest={protocol:'uvenaro-isolated-staging-v1',fixtureOnly:fixture,remoteDeploymentAuthorized:false,remoteChangesPerformed:false,providerCallsPermitted:false,
  databaseRoles:['billing','gateway-receipts','adapter-evidence'],pilotPreserved:true,files:hashes,
  requiredRemoteGates:['EXACT_MAIN_CI_GREEN','FRESH_CLOUDFLARE_PREFLIGHT_READY','ACTUAL_DATABASE_NAMES_AND_IDS_VERIFIED','SERVER_SECRET_SCOPES_VERIFIED']};
 await put('manifest.json',JSON.stringify(manifest,null,2)+'\n');return {directory:base,manifest};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.some(a=>a!=='--fixture'))throw Error('UNRECOGNIZED_STAGING_ARGUMENT');
  const result=await buildIsolatedStaging(undefined,{fixture:args.includes('--fixture')});
  console.log(JSON.stringify({fixtureOnly:result.manifest.fixtureOnly,fileCount:Object.keys(result.manifest.files).length,remoteChangesPerformed:false,providerCallsPermitted:false}));
 }catch(error){console.error(/^([A-Z_]+)$/.test(error.message)?error.message:'ISOLATED_STAGING_BUILD_FAILED');process.exitCode=1;}
}
