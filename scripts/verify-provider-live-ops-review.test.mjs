import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProviderLiveOpsEvidence} from '../backend/provider-live-ops-review.mjs';

const t='2026-10-09T08:00:00.000Z';
const complete={
 integrity:{protocol:'uvenaro-provider-evidence-integrity-v1',algorithm:'SHA-256',verified:true,digest:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},
 liveOpsSource:'operator-observed',liveOpsEvidenceVerified:true,liveOpsObservedAt:t,
 alertsVerified:true,alertsObservedAt:t,
 killSwitchVerified:true,killSwitchObservedAt:t,
 backupRestoreVerified:true,backupRestoreObservedAt:t,
 rollbackVerified:true,rollbackObservedAt:t,versionPinned:true
};

test('operator-observed live operations evidence reaches the gate',()=>{
 const result=evaluateProviderLiveOpsEvidence(complete);
 assert.equal(result.ok,true);
 assert.equal(result.checks.sourceOperatorObserved,true);
 assert.equal(result.checks.killSwitch,true);
 assert.equal(result.checks.rollback,true);
});

test('fixture-only or missing observations cannot pass live operations review',()=>{
 for(const patch of [
  {liveOpsSource:'local-fixture'},
  {liveOpsEvidenceVerified:false},
  {killSwitchVerified:false},
  {backupRestoreObservedAt:null},
  {rollbackVerified:false},
  {versionPinned:false}
 ])assert.equal(evaluateProviderLiveOpsEvidence({...complete,...patch}).ok,false);
});

test('future-proof review fails closed on invalid observation dates',()=>{
 assert.equal(evaluateProviderLiveOpsEvidence({...complete,liveOpsObservedAt:'not-a-date'}).ok,false);
 assert.equal(evaluateProviderLiveOpsEvidence({...complete,killSwitchObservedAt:'not-a-date'}).ok,false);
});
