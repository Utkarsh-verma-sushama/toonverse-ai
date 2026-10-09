import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planIsolatedStagingReaudit} from '../backend/isolated-staging-reaudit.mjs';

const deployment=JSON.parse(readFileSync(new URL('../deploy/isolated-staging/verified-deployment.json',import.meta.url),'utf8'));
const ciAttestation=JSON.parse(readFileSync(new URL('../deploy/isolated-staging/exact-main-ci-attestation.json',import.meta.url),'utf8'));

test('re-audit plan stays read-only and never authorizes activation',()=>{
 const result=planIsolatedStagingReaudit({deployment,ciAttestation,ownerSpendMicrousd:0,asOf:'2026-10-09T10:00:00Z'});
 assert.equal(result.eligible,true);
 assert.equal(result.mode,'read-only');
 assert.deepEqual(result.steps,['inventory','schema-fingerprint','private-binding-scope','safe-off-runtime','rollback-readiness']);
 assert.equal(result.writeAllowed,false);
 assert.equal(result.providerCallsAllowed,false);
 assert.equal(result.activationAllowed,false);
});

test('remote write, provider call or owner spend blocks the plan',()=>{
 for(const patch of [
  {deployment:{...deployment,remoteChangesPerformed:true}},
  {deployment:{...deployment,providerCallsPermitted:true}},
  {deployment:{...deployment,ownerSpendMicrousd:1}},
  {ciAttestation:{...ciAttestation,branch:'feature'}}
 ])assert.equal(planIsolatedStagingReaudit({deployment:{...deployment,...patch.deployment},ciAttestation:{...ciAttestation,...patch.ciAttestation},ownerSpendMicrousd:patch.deployment?.ownerSpendMicrousd??0,asOf:'2026-10-09T10:00:00Z'}).eligible,false);
});

test('missing evidence fails closed without enabling any path',()=>{
 const result=planIsolatedStagingReaudit({asOf:'2026-10-09T10:00:00Z'});
 assert.equal(result.eligible,false);
 assert.equal(result.writeAllowed,false);
 assert.equal(result.providerCallsAllowed,false);
 assert.equal(result.activationAllowed,false);
});
