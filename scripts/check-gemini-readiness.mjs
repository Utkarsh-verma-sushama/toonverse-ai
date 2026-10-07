import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const root=new URL('../',import.meta.url);
const read=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const auditFlags=['GEMINI_MODEL_PROFILE_AUDITED','GEMINI_PREFLIGHT_AUDITED','GEMINI_COUNT_TOKENS_NONBILLABLE_AUDITED','GEMINI_PRIVACY_PRICING_AUDITED'];
const roles=['billing','gateway-receipts','adapter-evidence'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Offline evidence consistency only. A historical receipt is neither a live
// account inspection nor permission to enable any provider or purchase credits.
export function inspectGeminiReadiness({firebase,account,adapter,gateway,receipt}={}){
 const errors=[];
 const check=(ok,code)=>{if(!ok)errors.push(code);};
 const projectId=firebase?.projects?.default;
 check(typeof projectId==='string'&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)&&account?.vars?.FIREBASE_PROJECT_ID===projectId,'FIREBASE_PROJECT_BINDING_MISMATCH');
 for(const [name,config] of [['ADAPTER',adapter],['GATEWAY',gateway]]){
  check(config?.workers_dev===false&&config?.preview_urls===false&&(!config.routes||Array.isArray(config.routes)&&config.routes.length===0)&&!config.route&&!config.custom_domain,'PRIVATE_'+name+'_ENDPOINT_REQUIRED');
  check(config?.observability?.enabled===false&&config?.vars?.ENVIRONMENT==='staging','PRIVATE_'+name+'_STAGING_REQUIRED');
  // Never print secret-shaped values, even when checking malformed input.
  check(!config?.vars||!Object.keys(config.vars).some(key=>/API_KEY$|DISPATCH_KEY$|RECEIPT_KEY$/.test(key)),'COMMITTED_'+name+'_SECRET_FORBIDDEN');
 }
 check(adapter?.vars?.GEMINI_MODEL===''&&adapter?.vars?.GEMINI_GENERATION_ENABLED==='false'&&adapter?.vars?.GEMINI_EXECUTION_CONFIRMATION===''&&auditFlags.every(key=>adapter?.vars?.[key]==='false'),'ADAPTER_SAFE_OFF_REQUIRED');
 check(gateway?.vars?.GATEWAY_PROVIDER===''&&gateway?.vars?.GATEWAY_MODEL===''&&gateway?.vars?.GATEWAY_GENERATION_ENABLED==='false'&&gateway?.vars?.GATEWAY_PAID_EXECUTION_CONFIRMATION===''&&gateway?.vars?.GATEWAY_PROVIDER_ADAPTER_AUDITED==='false'&&gateway?.vars?.GATEWAY_RECOVERY_ENABLED==='false'&&gateway?.vars?.GATEWAY_RECOVERY_CONFIRMATION==='','GATEWAY_SAFE_OFF_REQUIRED');
 check(gateway?.services?.length===1&&gateway.services[0]?.binding==='PROVIDER_ADAPTER'&&gateway.services[0]?.service===adapter?.name,'ADAPTER_SERVICE_BINDING_MISMATCH');

 const journal=receipt?.journal;
 check(receipt?.protocol==='uvenaro-verified-private-isolated-deployment-v1'&&/^[a-f0-9]{40}$/.test(receipt?.sourceCommit||'')&&receipt.sourceCommit===journal?.sha&&Number.isSafeInteger(receipt.workflowRunId)&&receipt.workflowRunId>0&&Number.isSafeInteger(receipt.artifactId)&&receipt.artifactId>0&&/^[a-f0-9]{64}$/.test(receipt.artifactSha256||'')&&/^[a-f0-9]{64}$/.test(journal?.manifestSha256||'')&&Number.isFinite(Date.parse(receipt.verifiedAt)),'ACCEPTANCE_PROVENANCE_INCONSISTENT');
 check(journal?.protocol==='uvenaro-safe-off-staging-upload-v1'&&journal.status==='private-safe-off-staging-accepted'&&journal.pending===null&&journal.probeRemoved===true&&journal.workersRestoredToBlankModel===true&&journal.pilotPreserved===true,'ACCEPTANCE_CLEANUP_INCOMPLETE');
 check(receipt?.privateEndpointsVerified===true&&receipt.secretScopesVerified===true&&receipt.providerCallsPermitted===false&&receipt.productionActivated===false&&receipt.publicLaunchAccepted===false&&journal?.providerRequestsPerformed===false,'ACCEPTANCE_SCOPE_INCONSISTENT');
 const databases=receipt?.databases;
 check(Array.isArray(databases)&&databases.length===3&&new Set(databases.map(db=>db?.uuid)).size===3&&new Set(databases.map(db=>db?.role)).size===3&&roles.every(role=>databases.some(db=>db?.role===role&&uuid.test(db.uuid||'')&&typeof db.name==='string')),'ISOLATED_DATABASE_IDENTITIES_INCONSISTENT');
 check(receipt?.orderedSqlFilesApplied===11&&Array.isArray(receipt.liveSchemaRolesVerified)&&receipt.liveSchemaRolesVerified.length===3&&roles.every(role=>receipt.liveSchemaRolesVerified.includes(role)),'SCHEMA_ACCEPTANCE_INCOMPLETE');
 const counts=receipt?.remoteFixtureChecks,steps=journal?.steps;
 check(counts?.beforeRestart===19&&counts.afterRestart===19&&counts.finalBlankModelSafeOff===8&&counts.total===46&&Array.isArray(steps)&&steps.filter(step=>step==='acceptance:/smoke:19').length===2&&steps.includes('acceptance:/final:8')&&steps.at(-1)==='remove-temporary-probe','FIXTURE_ACCEPTANCE_INCONSISTENT');
 const workers=receipt?.workers;
 check(Array.isArray(workers)&&workers.length===2&&new Set(workers.map(worker=>worker?.name)).size===2&&[[adapter?.name,journal?.adapterDeployment],[gateway?.name,journal?.gatewayDeployment]].every(([name,deployed])=>{
  const worker=workers.find(item=>item?.name===name);
  return worker&&uuid.test(worker.deployment?.id||'')&&worker.deployment.versions?.length===1&&uuid.test(worker.deployment.versions[0].version_id||'')&&worker.deployment.versions[0].percentage===100&&deployed?.length===1&&deployed[0]?.id===worker.deployment.id&&deployed[0].versions?.length===1&&deployed[0].versions[0].version_id===worker.deployment.versions[0].version_id&&deployed[0].versions[0].percentage===100;
 }),'WORKER_ACCEPTANCE_IDENTITIES_INCONSISTENT');

 return {
  protocol:'uvenaro-offline-gemini-readiness-v1',
  evidenceConsistent:errors.length===0,errors,
  evidenceScope:'historical-deployment-receipt-and-current-committed-configuration',
  liveAccountRechecked:false,activationAuthorized:false,providerAcceptanceVerified:false,
  firebaseProjectId:errors.includes('FIREBASE_PROJECT_BINDING_MISMATCH')?null:projectId,
  geminiProjectId:null,geminiProjectNumber:null,selectedGeminiModel:null,actualGeminiTier:'unverified',
  remainingGates:[
   'ACTUAL_GEMINI_PROJECT_KEY_BINDING_AND_TIER',
   'DATED_MODEL_ENDPOINT_AND_NONBILLABLE_COUNT_EVIDENCE',
   'PREFLIGHT_USAGE_THINKING_AND_LOST_RESPONSE_ACCEPTANCE',
   'PRIVACY_RETENTION_AGE_AND_REGION_ENFORCEMENT',
   'FUNDED_PRICE_SNAPSHOT_AND_ZERO_OWNER_SPEND_BOUNDARY'
  ]
 };
}

export function inspectCheckoutGeminiReadiness(){
 return inspectGeminiReadiness({firebase:read('.firebaserc'),account:read('deploy/account-staging/wrangler.json'),adapter:read('deploy/gemini-adapter/wrangler.json'),gateway:read('deploy/metered-gateway/wrangler.json'),receipt:read('deploy/isolated-staging/verified-deployment.json')});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report=inspectCheckoutGeminiReadiness();
 console.log(JSON.stringify(report,null,2));
 // A successful consistency check still leaves every Google acceptance gate open.
 if(!report.evidenceConsistent)process.exitCode=1;
}
