import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectGeminiReadiness} from './check-gemini-readiness.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const fixture=()=>({firebase:read('.firebaserc'),account:read('deploy/account-staging/wrangler.json'),adapter:read('deploy/gemini-adapter/wrangler.json'),gateway:read('deploy/metered-gateway/wrangler.json'),receipt:read('deploy/isolated-staging/verified-deployment.json')});
const reject=(change,code)=>{const input=fixture();change(input);const report=inspectGeminiReadiness(input);assert.equal(report.evidenceConsistent,false);assert.ok(report.errors.includes(code));assert.equal(report.activationAuthorized,false);};

test('accepted fixtures and Firebase binding never establish a Gemini project, tier or activation grant',()=>{
 const report=inspectGeminiReadiness(fixture());assert.equal(report.evidenceConsistent,true);
 assert.equal(report.firebaseProjectId,'toonverse-ai');assert.equal(report.geminiProjectId,null);assert.equal(report.geminiProjectNumber,null);
 assert.equal(report.actualGeminiTier,'unverified');assert.equal(report.selectedGeminiModel,null);
 assert.equal(report.providerAcceptanceVerified,false);assert.equal(report.activationAuthorized,false);assert.equal(report.liveAccountRechecked,false);
});
test('missing or malformed evidence fails closed without crashing',()=>{
 const report=inspectGeminiReadiness();assert.equal(report.evidenceConsistent,false);assert.equal(report.activationAuthorized,false);
 for(const change of [x=>{x.receipt.databases=[null];},x=>{x.receipt.workers=[null,null];},x=>{x.gateway.services=[null];},x=>{x.receipt.journal.adapterDeployment=[null];}]){
  const input=fixture();change(input);assert.equal(inspectGeminiReadiness(input).evidenceConsistent,false);
 }
});
test('Firebase project drift cannot be adopted as the Gemini project',()=>reject(x=>{x.account.vars.FIREBASE_PROJECT_ID='unverified-project';},'FIREBASE_PROJECT_BINDING_MISMATCH'));
test('fixture models and operator audit flags cannot silently become accepted configuration',()=>{
 for(const [key,value] of [['GEMINI_MODEL','gemini-3.8-flash'],['GEMINI_GENERATION_ENABLED','true'],['GEMINI_PREFLIGHT_AUDITED','true']])reject(x=>{x.adapter.vars[key]=value;},'ADAPTER_SAFE_OFF_REQUIRED');
 reject(x=>{x.gateway.vars.GATEWAY_RECOVERY_ENABLED='true';},'GATEWAY_SAFE_OFF_REQUIRED');
});
test('public endpoints, logging and redirected adapter service are rejected',()=>{
 reject(x=>{x.adapter.workers_dev=true;},'PRIVATE_ADAPTER_ENDPOINT_REQUIRED');
 reject(x=>{x.gateway.routes=['example.invalid/*'];},'PRIVATE_GATEWAY_ENDPOINT_REQUIRED');
 reject(x=>{x.adapter.observability.enabled=true;},'PRIVATE_ADAPTER_STAGING_REQUIRED');
 reject(x=>{x.gateway.services[0].service='unreviewed-adapter';},'ADAPTER_SERVICE_BINDING_MISMATCH');
});
test('malformed configuration errors do not echo credentials',()=>{
 const input=fixture(),secret='sensitive-value-never-print';input.adapter.vars.GEMINI_API_KEY=secret;
 const report=inspectGeminiReadiness(input);assert.ok(report.errors.includes('COMMITTED_ADAPTER_SECRET_FORBIDDEN'));assert.ok(!JSON.stringify(report).includes(secret));
});
test('incomplete cleanup or pending operations cannot pass a past-phase re-audit',()=>{
 reject(x=>{x.receipt.journal.pending='unacknowledged-write';},'ACCEPTANCE_CLEANUP_INCOMPLETE');
 reject(x=>{x.receipt.journal.probeRemoved=false;},'ACCEPTANCE_CLEANUP_INCOMPLETE');
 reject(x=>{x.receipt.journal.workersRestoredToBlankModel=false;},'ACCEPTANCE_CLEANUP_INCOMPLETE');
});
test('schema, aliasing and deployment version drift break acceptance consistency',()=>{
 reject(x=>{x.receipt.databases[1].uuid=x.receipt.databases[0].uuid;},'ISOLATED_DATABASE_IDENTITIES_INCONSISTENT');
 reject(x=>{x.receipt.orderedSqlFilesApplied=10;},'SCHEMA_ACCEPTANCE_INCOMPLETE');
 reject(x=>{x.receipt.journal.adapterDeployment[0].versions[0].percentage=50;},'WORKER_ACCEPTANCE_IDENTITIES_INCONSISTENT');
});
test('source, fixture count and provider-call scope cannot be silently broadened',()=>{
 reject(x=>{x.receipt.sourceCommit='a'.repeat(40);},'ACCEPTANCE_PROVENANCE_INCONSISTENT');
 reject(x=>{x.receipt.remoteFixtureChecks.total=45;},'FIXTURE_ACCEPTANCE_INCONSISTENT');
 reject(x=>{x.receipt.journal.providerRequestsPerformed=true;},'ACCEPTANCE_SCOPE_INCONSISTENT');
});
