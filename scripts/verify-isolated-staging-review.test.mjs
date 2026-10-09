import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateIsolatedStagingReview} from '../backend/isolated-staging-review.mjs';

const record=JSON.parse(readFileSync(new URL('../deploy/isolated-staging/verified-deployment.json',import.meta.url),'utf8'));
const asOf='2026-10-09T10:00:00.000Z';

test('historical isolated staging evidence reconciles without authorizing activation',()=>{
 const result=evaluateIsolatedStagingReview(record,asOf);
 assert.equal(result.historicalEvidenceValid,true);
 assert.equal(result.safeOff,true);
 assert.equal(result.activationAllowed,false);
 assert.equal(result.stagingReauditEligible,false);
 assert.equal(result.checks.threeDatabaseRoles,true);
 assert.equal(result.checks.workersVersionPinned,true);
});

test('fresh exact-main CI is required before staging re-audit is eligible',()=>{
 const result=evaluateIsolatedStagingReview({...record,freshMainCiVerified:true},asOf);
 assert.equal(result.stagingReauditEligible,true);
 assert.equal(result.activationAllowed,false);
});

test('unsafe deployment evidence fails closed',()=>{
 for(const patch of [
  {providerCallsPermitted:true},
  {productionActivated:true},
  {privateEndpointsVerified:false},
  {journal:{workersRestoredToBlankModel:false,probeRemoved:true}},
  {workers:[]}
 ])assert.equal(evaluateIsolatedStagingReview({...record,...patch},asOf).historicalEvidenceValid,false);
});

test('stale or future evidence is not re-audit eligible',()=>{
 assert.equal(evaluateIsolatedStagingReview({...record,verifiedAt:'2026-10-01T10:00:00Z',freshMainCiVerified:true},asOf).stagingReauditEligible,false);
 assert.equal(evaluateIsolatedStagingReview({...record,verifiedAt:'2026-10-10T10:00:00Z',freshMainCiVerified:true},asOf).stagingReauditEligible,false);
});
