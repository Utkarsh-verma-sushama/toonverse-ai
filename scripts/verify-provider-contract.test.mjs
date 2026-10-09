import test from 'node:test';
import assert from 'node:assert/strict';
import {
 PROVIDER_CONTRACT_PROTOCOL,
 getProviderContract,
 validateProviderContract
} from '../backend/provider-contract.mjs';
import {enforceGeminiPrivacyPolicy,validateGeminiPrivacyPolicy} from '../backend/provider-privacy-policy.mjs';

const base={ENVIRONMENT:'staging',GEMINI_MODEL:'',GEMINI_PROVIDER:'google-gemini'};

test('the registry exposes an immutable bounded contract instead of provider assumptions in billing code',()=>{
 const contract=getProviderContract('google-gemini');
 assert.equal(PROVIDER_CONTRACT_PROTOCOL,'uvenaro-provider-contract-v1');
 assert.equal(contract.protocol,'bounded-metered-v1');
 assert.deepEqual(contract.methods,{countTokens:'countTokens',generateContent:'generateContent'});
 assert.deepEqual(contract.limits,{maxInputTokens:12000,maxOutputTokens:12000,maxTotalTokens:20000});
 assert.deepEqual(contract.controls,{candidateCount:1,thinkingLevel:'low',streaming:false,tools:false});
 assert.deepEqual(contract.privacy,{store:false,background:false,fileApi:false,contextCaching:false,grounding:false,retentionDays:0,promptsPersisted:false,answersPersisted:false});
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


test('privacy policy is immutable and rejects retention or background controls',()=>{
 const contract=getProviderContract('google-gemini');
 assert.equal(validateGeminiPrivacyPolicy(contract.privacy).ok,true);
 for(const change of [
  {store:true},
  {background:true},
  {fileApi:true},
  {contextCaching:true},
  {grounding:true},
  {retentionDays:1},
  {promptsPersisted:true},
  {answersPersisted:true}
 ]){
  const report=validateGeminiPrivacyPolicy({...contract.privacy,...change});
  assert.equal(report.ok,false);
 }
});

test('request privacy guard fails closed for every persistence path',()=>{
 for(const request of [
  {store:true},{background:true},{fileApi:true},{file:true},
  {contextCaching:true},{cachedContent:'cache-1'},{grounding:true},
  {googleSearch:true},{retentionDays:7}
 ]){
  const report=enforceGeminiPrivacyPolicy(request);
  assert.equal(report.ok,false);
  assert.ok(report.errors.length>0);
  assert.equal(report.normalized.store,false);
  assert.equal(report.normalized.background,false);
 }
 assert.equal(enforceGeminiPrivacyPolicy({}).ok,true);
});
