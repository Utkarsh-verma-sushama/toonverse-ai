import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateProviderOperationsEvidence} from '../backend/provider-operations-policy.mjs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/provider-acceptance/funding-operations-evidence.json',import.meta.url),'utf8'));

test('funding evidence records zero owner spend without enabling billing',()=>{
 assert.equal(bundle.protocol,'uvenaro-provider-funding-operations-evidence-v1');
 assert.equal(bundle.funding.billingAccountConfigured,false);
 assert.equal(bundle.funding.ownerSpendCapMicrousd,0);
 assert.equal(bundle.funding.autoTopUp,false);
 assert.equal(bundle.funding.paidRequestsAllowed,false);
 assert.equal(bundle.funding.zeroOwnerSpendBoundary,true);
 assert.equal(bundle.funding.projectSpendObservedMicrousd,0);
});

test('operations fixture evidence verifies controls but does not authorize activation',()=>{
 const result=evaluateProviderOperationsEvidence(bundle.operations);
 assert.equal(result.ok,true);
 assert.equal(bundle.acceptanceDecision.status,'SAFE_OFF_PENDING');
 assert.equal(bundle.acceptanceDecision.activationAuthorized,false);
 assert.equal(bundle.operations.publicEndpointEnabled,false);
});

test('evidence bundle never contains secrets or user content',()=>{
 const serialized=JSON.stringify(bundle);
 assert.doesNotMatch(serialized,/AIza[0-9A-Za-z_-]{20,}/);
 assert.doesNotMatch(serialized,/sk-[A-Za-z0-9_-]{20,}/);
 assert.doesNotMatch(serialized,/-----BEGIN [A-Z ]+ KEY-----/);
 assert.match(serialized,/\"promptsStored\":false/);\n assert.match(serialized,/\"answersStored\":false/);
});
