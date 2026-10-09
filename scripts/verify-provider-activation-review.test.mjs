import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getProviderContract} from '../backend/provider-contract.mjs';
import {reviewProviderActivation} from '../backend/provider-activation-review.mjs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/provider-acceptance/evidence.json',import.meta.url),'utf8'));
const contract=getProviderContract(bundle.provider);
const asOf='2026-10-09T06:30:00.000Z';

function completeEvidence(){
 const t='2026-10-09T06:00:00.000Z';
 return {
  project:{bindingVerified:true,observedAt:t},
  tier:{verified:true,name:'free',observedAt:t},
  model:{profileVerified:true,endpointVerified:true,methods:['countTokens','generateContent'],profileObservedAt:t,endpointObservedAt:t},
  pricing:{snapshotVerified:true,snapshotAt:t},
  funding:{sourceVerified:true,zeroOwnerSpendBoundary:true,billingConfigured:false,ownerSpendCapMicrousd:0,autoTopUp:false,paidRequestsAllowed:false,fundingSource:'provider-free-tier',observedAt:t},
  privacy:{privacyReviewed:true,retentionReviewed:true,regionReviewed:true,agePolicyReviewed:true,reviewedAt:t,retentionReviewedAt:t,regionReviewedAt:t,agePolicyReviewedAt:t},
  usage:{countTokensNonbillableVerified:true,preflightHeadroomVerified:true,thinkingOutputAccountingVerified:true,countTokensObservedAt:t,preflightObservedAt:t,thinkingOutputObservedAt:t},
  reconciliation:{lostResponsePolicyVerified:true,noAutomaticRetryVerified:true,receiptIdentityVerified:true,lostResponseObservedAt:t,retryPolicyObservedAt:t,receiptIdentityObservedAt:t},
 operations:{integrity:{protocol:'uvenaro-provider-evidence-integrity-v1',algorithm:'SHA-256',verified:true,digest:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},alertsVerified:true,backupRestoreVerified:true,rollbackVerified:true,killSwitchVerified:true,killSwitchObservedAt:t,alertThresholdsDeclared:true,versionPinned:true,automaticRetry:false,promptLogging:false,answerLogging:false,publicEndpoint:false,liveOpsSource:'operator-observed',liveOpsEvidenceVerified:true,liveOpsObservedAt:t,killSwitchRequired:true,backupRestoreRequired:true,rollbackMode:'version-pinned',alertThresholds:{errorRatePct:5,reconciliationOpen:1,latencyMs:30000,spendMicrousd:0},alertsObservedAt:t,backupRestoreObservedAt:t,rollbackObservedAt:t},
  authorization:{activationAuthorized:false}
 };
}

test('current sanitized bundle remains safe-off and cannot be activation-ready',()=>{
 const review=reviewProviderActivation({contract,evidence:bundle.evidence,runtime:bundle.runtime,asOf});
 assert.equal(review.status,'SAFE_OFF_PENDING');
 assert.equal(review.activationEligible,false);
 assert.equal(review.executionPermitted,false);
 assert.equal(review.safeOff,true);
 assert.ok(review.blockers.includes('MODEL_AND_CAPABILITY'));
 assert.ok(review.blockers.includes('PRICING_AND_ZERO_OWNER_SPEND'));
 assert.ok(review.blockers.includes('OPERATIONS_AND_ROLLBACK'));
});

test('complete fresh evidence reaches explicit-authorization boundary but never auto-executes',()=>{
 const review=reviewProviderActivation({
  contract,evidence:completeEvidence(),
  runtime:{generationEnabled:false,activationAuthorized:false,providerRequestsPermitted:false},
  asOf
 });
 assert.equal(review.status,'READY_FOR_EXPLICIT_AUTHORIZATION');
 assert.equal(review.activationEligible,true);
 assert.equal(review.executionPermitted,false);
 assert.equal(review.safeOff,true);
 assert.deepEqual(review.blockers,[]);
});

test('stale pricing evidence blocks activation even when every acceptance gate passes',()=>{
 const evidence=completeEvidence();
 evidence.pricing.snapshotAt='2026-10-08T23:00:00.000Z';
 const review=reviewProviderActivation({
  contract,evidence,
  runtime:{generationEnabled:false,activationAuthorized:false,providerRequestsPermitted:false},
  asOf
 });
 assert.equal(review.status,'SAFE_OFF_PENDING');
 assert.equal(review.activationEligible,false);
 assert.ok(review.blockers.includes('PRICING_AND_ZERO_OWNER_SPEND'));
 assert.equal(review.freshness.find(item=>item.id==='PRICING_AND_ZERO_OWNER_SPEND').status,'stale');
});

test('execution is rejected without a structured operator authorization record',()=>{
 const evidence=completeEvidence();
 evidence.authorization={activationAuthorized:true};
 const review=reviewProviderActivation({
  contract,evidence,
  runtime:{generationEnabled:true,activationAuthorized:true,providerRequestsPermitted:true},
  asOf
 });
 assert.equal(review.status,'REJECTED');
 assert.equal(review.executionPermitted,false);
 assert.ok(review.blockers.includes('AUTHORIZATION_RECORD'));
});
