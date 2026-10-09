import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProviderReadinessPass} from '../backend/provider-readiness-pass.mjs';

const complete={
 isolatedResources:true,schemasApplied:true,privateBindings:true,
 smokeDrill:true,restartRecoveryDrill:true,rollbackDrill:true,
 generationEnabled:false,paidConfirmation:false,apiKeyPresent:false,
 externalProviderCalls:false,publicEndpoint:false,backgroundAi:false,
 unknownOutcomeFailsClosed:true
};

test('fixture-only readiness pass requires every safe-off control',()=>{
 const result=evaluateProviderReadinessPass(complete);
 assert.equal(result.readyForIsolatedFixture,true);
 assert.equal(result.activationAllowed,false);
});

test('readiness fails closed if any external or paid path is enabled',()=>{
 for(const patch of [
  {generationEnabled:true},{paidConfirmation:true},{apiKeyPresent:true},
  {externalProviderCalls:true},{publicEndpoint:true},{backgroundAi:true},
  {unknownOutcomeFailsClosed:false},{rollbackDrill:false}
 ])assert.equal(evaluateProviderReadinessPass({...complete,...patch}).readyForIsolatedFixture,false);
});

test('missing staging evidence never becomes activation permission',()=>{
 const result=evaluateProviderReadinessPass({});
 assert.equal(result.readyForIsolatedFixture,false);
 assert.equal(result.activationAllowed,false);
});
