import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateExactMainCiAttestation} from '../backend/isolated-staging-ci-attestation.mjs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/isolated-staging/exact-main-ci-attestation.json',import.meta.url),'utf8'));

test('exact-main CI evidence enables only staging re-audit',()=>{
 const result=evaluateExactMainCiAttestation(bundle);
 assert.equal(result.exactMainCiGreen,true);
 assert.equal(result.stagingReauditEligible,true);
 assert.equal(result.activationAllowed,false);
 assert.equal(bundle.decision.activationAllowed,false);
});

test('CI evidence contains no secrets or user content',()=>{
 const serialized=JSON.stringify(bundle);
 assert.doesNotMatch(serialized,/AIza[0-9A-Za-z_-]{20,}/);
 assert.doesNotMatch(serialized,/sk-[A-Za-z0-9_-]{20,}/);
 assert.equal(bundle.redaction.promptsStored,false);
 assert.equal(bundle.redaction.answersStored,false);
 assert.equal(bundle.redaction.rawResponsesStored,false);
});
