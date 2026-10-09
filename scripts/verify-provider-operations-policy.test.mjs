import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DEFAULT_PROVIDER_OPERATIONS_POLICY,
 evaluateProviderOperationsEvidence,
 runProviderOperationsFixture,
 validateProviderOperationsPolicy
} from '../backend/provider-operations-policy.mjs';

test('operations policy requires kill-switch and version-pinned rollback',()=>{
 const result=validateProviderOperationsPolicy(DEFAULT_PROVIDER_OPERATIONS_POLICY);
 assert.equal(result.ok,true);
 assert.equal(DEFAULT_PROVIDER_OPERATIONS_POLICY.killSwitchRequired,true);
 assert.equal(DEFAULT_PROVIDER_OPERATIONS_POLICY.rollbackMode,'version-pinned');
 assert.equal(DEFAULT_PROVIDER_OPERATIONS_POLICY.automaticRetry,false);
});

test('operations evidence only passes when every safety control is verified',()=>{
 const evidence={
  killSwitchVerified:true,alertThresholdsDeclared:true,backupRestoreVerified:true,
  rollbackVerified:true,versionPinned:true,automaticRetry:false,promptLogging:false,
  answerLogging:false,publicEndpoint:false
 };
 assert.equal(evaluateProviderOperationsEvidence(evidence).ok,true);
 assert.equal(evaluateProviderOperationsEvidence({...evidence,rollbackVerified:false}).ok,false);
 assert.equal(evaluateProviderOperationsEvidence({...evidence,publicEndpoint:true}).ok,false);
});

test('operations policy fails closed on unsafe controls',()=>{
 for(const patch of [
  {killSwitchRequired:false},{rollbackMode:'latest'},{automaticRetry:true},
  {promptLogging:true},{answerLogging:true},{publicEndpoint:true},
  {alertThresholds:{errorRatePct:0,reconciliationOpen:0,latencyMs:0,spendMicrousd:1}}
 ])assert.equal(validateProviderOperationsPolicy({...DEFAULT_PROVIDER_OPERATIONS_POLICY,...patch}).ok,false);
});


test('operations fixture exercises kill-switch, restore and pinned rollback',()=>{
 const result=runProviderOperationsFixture();
 assert.deepEqual(result,{killSwitchVerified:true,backupRestoreVerified:true,rollbackVerified:true,versionPinned:true});
});
