import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/isolated-staging/reconciliation-review.json',import.meta.url),'utf8'));

test('reconciliation review remains non-authorizing and zero-spend',()=>{
 assert.equal(bundle.protocol,'uvenaro-isolated-staging-review-v1');
 assert.equal(bundle.historicalEvidenceValid,true);
 assert.equal(bundle.freshMainCiVerified,false);
 assert.equal(bundle.stagingReauditEligible,false);
 assert.equal(bundle.activationAllowed,false);
 assert.equal(bundle.safeOff,true);
 assert.equal(bundle.ownerSpendMicrousd,0);
});

test('reconciliation review contains no secret or raw response material',()=>{
 const serialized=JSON.stringify(bundle);
 assert.doesNotMatch(serialized,/AIza[0-9A-Za-z_-]{20,}/);
 assert.doesNotMatch(serialized,/sk-[A-Za-z0-9_-]{20,}/);
 assert.equal(bundle.redaction.promptsStored,false);
 assert.equal(bundle.redaction.answersStored,false);
 assert.equal(bundle.redaction.rawResponsesStored,false);
});
