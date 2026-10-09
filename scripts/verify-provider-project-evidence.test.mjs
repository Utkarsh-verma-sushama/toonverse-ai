import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const evidence=JSON.parse(readFileSync(new URL('../deploy/provider-acceptance/project-evidence.json',import.meta.url),'utf8'));

test('project dashboard evidence confirms safe free-tier binding and zero observed usage',()=>{
 assert.equal(evidence.project.id,'toonverse-ai');
 assert.equal(evidence.project.bindingVerified,true);
 assert.equal(evidence.tier.name,'free');
 assert.equal(evidence.billing.configured,false);
 assert.equal(evidence.usage.totalApiRequests,0);
 assert.equal(evidence.quotaHeadroom.dashboardObserved,true);
 assert.equal(evidence.quotaHeadroom.currentPeakUsage,0);
 assert.equal(evidence.runtimePolicy.generationEnabled,false);
 assert.equal(evidence.runtimePolicy.providerRequestsPermitted,false);
 assert.equal(evidence.runtimePolicy.backgroundAiEnabled,false);
 assert.equal(evidence.runtimePolicy.zeroOwnerSpendBoundary,true);
});

test('dashboard evidence cannot falsely pass endpoint verification',()=>{
 assert.equal(evidence.endpointVerification.modelsListCalled,true);
 assert.equal(evidence.endpointVerification.countTokensCalled,true);
 assert.equal(evidence.endpointVerification.generateContentCalled,false);
 assert.equal(evidence.endpointVerification.verified,true);
 assert.equal(evidence.acceptanceDecision.status,'SAFE_OFF_PENDING');
 assert.equal(evidence.acceptanceDecision.modelEndpointGate,'verified_non_generation');
 assert.equal(evidence.endpointVerification.generateContentCalled,false);
 assert.equal(evidence.endpointVerification.model,'gemini-3.8-flash');
 assert.equal(evidence.endpointVerification.countTokensTotalTokens,13);
 assert.equal(/AIza|sk-|BEGIN .* PRIVATE KEY/.test(JSON.stringify(evidence)),false);
});
