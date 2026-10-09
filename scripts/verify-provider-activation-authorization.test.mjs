import test from 'node:test';
import assert from 'node:assert/strict';
import {
 PROVIDER_ACTIVATION_AUTHORIZATION_SCOPE,
 evaluateProviderActivationAuthorization
} from '../backend/provider-activation-authorization.mjs';

const asOf='2026-10-09T09:00:00.000Z';
const valid={
 activationAuthorized:true,approvedBy:'owner-operator',approvedAt:'2026-10-09T08:30:00.000Z',
 scope:PROVIDER_ACTIVATION_AUTHORIZATION_SCOPE,reason:'approved after complete provider review',
 authorizationId:'auth_20261009_01',integrityVerified:true,
 authorizationDigest:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
 ownerSpendCapMicrousd:0,billingChangeAuthorized:false,backgroundAiEnabled:false
};

test('complete authorization requires scope, freshness, zero spend and integrity',()=>{
 const result=evaluateProviderActivationAuthorization(valid,asOf);
 assert.equal(result.ok,true);
});

test('missing or unsafe authorization controls fail closed',()=>{
 for(const patch of [
  {activationAuthorized:false},{scope:'billing-change'},{integrityVerified:false},
  {ownerSpendCapMicrousd:1},{billingChangeAuthorized:true},{backgroundAiEnabled:true},
  {approvedAt:'2026-10-09T07:00:00.000Z'}
 ])assert.equal(evaluateProviderActivationAuthorization({...valid,...patch},asOf).ok,false);
});

test('future and stale authorizations fail closed',()=>{
 assert.equal(evaluateProviderActivationAuthorization({...valid,approvedAt:'2026-10-09T09:01:00.000Z'},asOf).ok,false);
 assert.equal(evaluateProviderActivationAuthorization({...valid,approvedAt:'2026-10-09T07:00:00.000Z'},asOf).ok,false);
});
