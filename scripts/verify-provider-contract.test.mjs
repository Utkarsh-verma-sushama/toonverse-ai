import test from 'node:test';
import assert from 'node:assert/strict';
import {
 PROVIDER_CONTRACT_PROTOCOL,
 getProviderContract,
 validateProviderContract
} from '../backend/provider-contract.mjs';

const base={ENVIRONMENT:'staging',GEMINI_MODEL:'',GEMINI_PROVIDER:'google-gemini'};

test('the registry exposes an immutable bounded contract instead of provider assumptions in billing code',()=>{
 const contract=getProviderContract('google-gemini');
 assert.equal(PROVIDER_CONTRACT_PROTOCOL,'uvenaro-provider-contract-v1');
 assert.equal(contract.protocol,'bounded-metered-v1');
 assert.deepEqual(contract.methods,{countTokens:'countTokens',generateContent:'generateContent'});
 assert.deepEqual(contract.limits,{maxInputTokens:12000,maxOutputTokens:12000,maxTotalTokens:20000});
 assert.deepEqual(contract.controls,{candidateCount:1,thinkingLevel:'low',streaming:false,tools:false});
 assert.equal(Object.isFrozen(contract),true);
 assert.equal(Object.isFrozen(contract.limits),true);
});

test('safe-off configuration accepts a blank model without creating activation evidence',()=>{
 const report=validateProviderContract(base,{allowBlankModel:true});
 assert.equal(report.ok,true);
 assert.deepEqual(report.errors,[]);
});

test('generation requires a supported model profile and rejects unknown providers',()=>{
 const unsupported=validateProviderContract({...base,GEMINI_MODEL:'gemini-future-ultra'},{allowBlankModel:false});
 assert.equal(unsupported.ok,false);
 assert.ok(unsupported.errors.includes('MODEL_PROFILE_UNSUPPORTED'));
 const unknown=validateProviderContract({...base,GEMINI_PROVIDER:'future-provider'},{allowBlankModel:true});
 assert.equal(unknown.ok,false);
 assert.ok(unknown.errors.includes('UNKNOWN_PROVIDER_CONTRACT'));
});

test('contract capability and accounting fields are complete before activation',()=>{
 const contract=getProviderContract('google-gemini');
 for(const key of ['prompt','candidate','thoughts','total','cached','tools'])
  assert.equal(typeof contract.accounting[key],'string');
 assert.deepEqual(contract.requiredAuditFlags,[
  'GEMINI_MODEL_PROFILE_AUDITED',
  'GEMINI_PREFLIGHT_AUDITED',
  'GEMINI_COUNT_TOKENS_NONBILLABLE_AUDITED',
  'GEMINI_PRIVACY_PRICING_AUDITED'
 ]);
});
