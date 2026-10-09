import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DEFAULT_PROVIDER_FUNDING_POLICY,
 enforceProviderFundingPolicy,
 validateProviderFundingPolicy
} from '../backend/provider-funding-policy.mjs';

test('funding policy is immutable and zero-owner-spend by default',()=>{
 const result=validateProviderFundingPolicy(DEFAULT_PROVIDER_FUNDING_POLICY);
 assert.equal(result.ok,true);
 assert.equal(DEFAULT_PROVIDER_FUNDING_POLICY.ownerSpendCapMicrousd,0);
 assert.equal(DEFAULT_PROVIDER_FUNDING_POLICY.autoTopUp,false);
 assert.equal(DEFAULT_PROVIDER_FUNDING_POLICY.paidRequestsAllowed,false);
 assert.throws(()=>{DEFAULT_PROVIDER_FUNDING_POLICY.autoTopUp=true;},TypeError);
});

test('funding request rejects every spend-enabling path',()=>{
 for(const request of [
  {billingConfigured:true},
  {autoTopUp:true},
  {paidRequestsAllowed:true},
  {ownerSpendMicrousd:1},
  {ownerSpendCapMicrousd:1},
  {fundingSource:'owner-card'}
 ])assert.throws(()=>enforceProviderFundingPolicy(request));
 assert.deepEqual(enforceProviderFundingPolicy({}),DEFAULT_PROVIDER_FUNDING_POLICY);
});

test('funding policy fails closed on malformed or changed controls',()=>{
 for(const patch of [
  {billingConfigured:true},{ownerSpendCapMicrousd:100},{autoTopUp:true},
  {paidRequestsAllowed:true},{zeroOwnerSpendBoundary:false},{fundingSource:'unknown'}
 ])assert.equal(validateProviderFundingPolicy({...DEFAULT_PROVIDER_FUNDING_POLICY,...patch}).ok,false);
});
