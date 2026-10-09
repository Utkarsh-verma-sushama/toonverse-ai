import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateProviderReadinessPass} from '../backend/provider-readiness-pass.mjs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/provider-acceptance/provider-readiness-pass.json',import.meta.url),'utf8'));

test('readiness evidence passes only as an isolated fixture',()=>{
 const result=evaluateProviderReadinessPass(bundle);
 assert.equal(result.readyForIsolatedFixture,true);
 assert.equal(result.activationAllowed,false);
 assert.equal(bundle.decision.status,'FIXTURE_READINESS_PASS');
 assert.equal(bundle.decision.productionProvisioningPerformed,false);
 assert.equal(bundle.decision.providerCallsPerformed,false);
});

test('readiness evidence has no secret or user content',()=>{
 const serialized=JSON.stringify(bundle);
 assert.doesNotMatch(serialized,/AIza[0-9A-Za-z_-]{20,}/);
 assert.doesNotMatch(serialized,/sk-[A-Za-z0-9_-]{20,}/);
 assert.equal(bundle.redaction.promptsStored,false);
 assert.equal(bundle.redaction.answersStored,false);
 assert.equal(bundle.redaction.apiResponsesStored,false);
});
