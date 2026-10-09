import test from 'node:test';
import assert from 'node:assert/strict';
import {executeReadOnlyStagingReaudit} from '../backend/isolated-staging-reaudit-execution.mjs';

const plan={protocol:'uvenaro-isolated-staging-reaudit-v1',eligible:true,steps:['inventory','schema-fingerprint','private-binding-scope','safe-off-runtime','rollback-readiness']};
const observations=plan.steps.map(step=>({step,mode:'fixture',passed:true,remoteWrite:false,providerCall:false,safeOff:true}));

test('fixture re-audit executes all checks without side effects',()=>{
 const result=executeReadOnlyStagingReaudit({plan,observations});
 assert.equal(result.status,'FIXTURE_REAUDIT_PASS');
 assert.equal(result.complete,true);
 assert.equal(result.remoteExecutionPerformed,false);
 assert.equal(result.providerCallsPerformed,false);
 assert.equal(result.activationAllowed,false);
});

test('failed, duplicated or unsafe observations block completion',()=>{
 for(const patch of [
  {observations:observations.map((row,i)=>i===0?{...row,passed:false}:row)},
  {observations:[...observations,observations[0]]},
  {observations:observations.map((row,i)=>i===1?{...row,remoteWrite:true}:row)},
  {observations:observations.map((row,i)=>i===2?{...row,providerCall:true}:row)},
  {observations:observations.map((row,i)=>i===3?{...row,safeOff:false}:row)}
 ])assert.equal(executeReadOnlyStagingReaudit({plan,...patch}).complete,false);
});

test('missing plan or observations fails closed',()=>{
 const result=executeReadOnlyStagingReaudit({});
 assert.equal(result.complete,false);
 assert.equal(result.remoteExecutionPerformed,false);
 assert.equal(result.providerCallsPerformed,false);
 assert.equal(result.activationAllowed,false);
});
