import test from 'node:test';
import assert from 'node:assert/strict';
import {getProviderContract} from '../backend/provider-contract.mjs';
import {
 PROVIDER_ACCEPTANCE_PROTOCOL,
 REQUIRED_PROVIDER_GATES,
 evaluateProviderAcceptance
} from '../backend/provider-acceptance.mjs';

const contract=getProviderContract('google-gemini');
const readyEvidence=()=>({
 project:{bindingVerified:true},
 tier:{verified:true,name:'free',observedAt:'2026-10-09T00:00:00Z'},
 model:{profileVerified:true,endpointVerified:true,methods:['countTokens','generateContent']},
 pricing:{snapshotVerified:true,snapshotAt:'2026-10-09T00:00:00Z'},
 funding:{sourceVerified:true,zeroOwnerSpendBoundary:true,billingConfigured:false,ownerSpendCapMicrousd:0,autoTopUp:false,paidRequestsAllowed:false,fundingSource:'provider-free-tier'},
 privacy:{privacyReviewed:true,retentionReviewed:true,regionReviewed:true,agePolicyReviewed:true},
 usage:{countTokensNonbillableVerified:true,preflightHeadroomVerified:true,thinkingOutputAccountingVerified:true},
 reconciliation:{lostResponsePolicyVerified:true,noAutomaticRetryVerified:true,receiptIdentityVerified:true},
 operations:{integrity:{protocol:'uvenaro-provider-evidence-integrity-v1',algorithm:'SHA-256',verified:true,digest:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},alertsVerified:true,alertsObservedAt:'2026-10-09T00:00:00Z',backupRestoreVerified:true,backupRestoreObservedAt:'2026-10-09T00:00:00Z',rollbackVerified:true,rollbackObservedAt:'2026-10-09T00:00:00Z',killSwitchVerified:true,killSwitchObservedAt:'2026-10-09T00:00:00Z',alertThresholdsDeclared:true,versionPinned:true,automaticRetry:false,promptLogging:false,answerLogging:false,publicEndpoint:false,liveOpsSource:'operator-observed',liveOpsEvidenceVerified:true,liveOpsObservedAt:'2026-10-09T00:00:00Z',killSwitchRequired:true,backupRestoreRequired:true,rollbackMode:'version-pinned',alertThresholds:{errorRatePct:5,reconciliationOpen:1,latencyMs:30000,spendMicrousd:0}},
 authorization:{activationAuthorized:false}
});

test('current safe-off evidence remains pending and cannot authorize activation',()=>{
 const report=evaluateProviderAcceptance({contract,evidence:{
  project:{bindingVerified:true},
  tier:{verified:true,name:'free',observedAt:'2026-10-09T00:00:00Z'}
 },runtime:{generationEnabled:false}});
 assert.equal(report.protocol,PROVIDER_ACCEPTANCE_PROTOCOL);
 assert.equal(report.status,'SAFE_OFF_PENDING');
 assert.equal(report.providerAcceptanceVerified,false);
 assert.equal(report.activationAuthorized,false);
 assert.equal(report.generationAllowed,false);
 assert.ok(report.blockers.includes('MODEL_AND_CAPABILITY'));
 assert.equal(report.gates.length,REQUIRED_PROVIDER_GATES.length);
});

test('complete dated evidence reaches review but never authorizes without explicit approval',()=>{
 const report=evaluateProviderAcceptance({contract,evidence:readyEvidence(),runtime:{generationEnabled:false}});
 assert.equal(report.status,'READY_FOR_AUTHORIZED_ACTIVATION');
 assert.equal(report.providerAcceptanceVerified,true);
 assert.equal(report.activationAuthorized,false);
 assert.equal(report.generationAllowed,false);
 assert.deepEqual(report.blockers,[]);
});

test('explicit activation is accepted only after every gate passes',()=>{
 const evidence=readyEvidence();evidence.authorization.activationAuthorized=true;
 const report=evaluateProviderAcceptance({contract,evidence,runtime:{activationAuthorized:true}});
 assert.equal(report.status,'ACTIVATION_AUTHORIZED');
 assert.equal(report.activationAuthorized,true);
 assert.equal(report.generationAllowed,true);
});

test('generation request with incomplete evidence is rejected fail-closed',()=>{
 const report=evaluateProviderAcceptance({contract,evidence:readyEvidence(),runtime:{generationEnabled:true}});
 const evidence=readyEvidence();delete evidence.privacy.regionReviewed;
 const blocked=evaluateProviderAcceptance({contract,evidence,runtime:{generationEnabled:true}});
 assert.equal(report.status,'REJECTED');
 assert.equal(report.activationAuthorized,false);
 assert.equal(report.generationAllowed,false);
 assert.equal(blocked.status,'REJECTED');
 assert.ok(blocked.errors.includes('ACTIVATION_GATES_INCOMPLETE'));
 assert.ok(blocked.blockers.includes('PRIVACY_RETENTION_AND_REGION'));
});

test('invalid dates, missing contract and malformed evidence do not pass',()=>{
 const evidence=readyEvidence();evidence.tier.observedAt='not-a-date';
 const dated=evaluateProviderAcceptance({contract,evidence});
 assert.equal(dated.providerAcceptanceVerified,false);
 assert.ok(dated.blockers.includes('PROJECT_AND_TIER'));
 const missing=evaluateProviderAcceptance({contract:null,evidence:readyEvidence()});
 assert.equal(missing.providerAcceptanceVerified,false);
 assert.ok(missing.errors.includes('CONTRACT_UNAVAILABLE'));
});
