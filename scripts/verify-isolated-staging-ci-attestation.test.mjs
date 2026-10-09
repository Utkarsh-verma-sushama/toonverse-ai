import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateExactMainCiAttestation} from '../backend/isolated-staging-ci-attestation.mjs';

const sha='44d91d8f8a249c07eb6e3b252ee2f230e3ecf6d2';
const workflows=[
 {name:'Cloud runtime validation',headSha:sha,status:'completed',conclusion:'success',runId:37902340443},
 {name:'Security policy gate',headSha:sha,status:'completed',conclusion:'success',runId:37902340395},
 {name:'Native build validation',headSha:sha,status:'completed',conclusion:'success',runId:37902340422},
 {name:'pages build and deployment',headSha:sha,status:'completed',conclusion:'success',runId:37902340818}
];
const complete={protocol:'uvenaro-isolated-staging-ci-attestation-v1',branch:'main',headSha:sha,workflows,providerCallsPerformed:false,productionActivated:false,ownerSpendMicrousd:0};

test('same-main four-workflow attestation enables staging re-audit only',()=>{
 const result=evaluateExactMainCiAttestation(complete);
 assert.equal(result.exactMainCiGreen,true);
 assert.equal(result.stagingReauditEligible,true);
 assert.equal(result.activationAllowed,false);
});

test('wrong commit, failed workflow or paid path fails closed',()=>{
 for(const patch of [
  {headSha:'a'.repeat(40)},
  {workflows:workflows.map(item=>({...item,conclusion:'failure'}))},
  {providerCallsPerformed:true},
  {productionActivated:true},
  {ownerSpendMicrousd:1}
 ])assert.equal(evaluateExactMainCiAttestation({...complete,...patch}).exactMainCiGreen,false);
});

test('missing or duplicate workflow evidence cannot pass',()=>{
 assert.equal(evaluateExactMainCiAttestation({}).exactMainCiGreen,false);
 assert.equal(evaluateExactMainCiAttestation({...complete,workflows:[...workflows,workflows[0]]}).exactMainCiGreen,false);
});
