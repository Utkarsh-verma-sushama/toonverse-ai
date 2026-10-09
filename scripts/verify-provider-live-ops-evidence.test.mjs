import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateProviderLiveOpsEvidence} from '../backend/provider-live-ops-review.mjs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/provider-acceptance/live-operations-review.json',import.meta.url),'utf8'));

test('live operations ledger stays pending until operator observation',()=>{
 assert.equal(bundle.protocol,'uvenaro-provider-live-ops-review-v1');
 assert.equal(bundle.liveOpsSource,'pending-operator-observation');
 assert.equal(bundle.liveOpsEvidenceVerified,false);
 assert.equal(bundle.decision.status,'SAFE_OFF_PENDING');
 assert.equal(bundle.decision.activationAuthorized,false);
 const result=evaluateProviderLiveOpsEvidence(bundle);
 assert.equal(result.ok,false);
});

test('live operations ledger contains no secrets or user content',()=>{
 const serialized=JSON.stringify(bundle);
 assert.doesNotMatch(serialized,/AIza[0-9A-Za-z_-]{20,}/);
 assert.doesNotMatch(serialized,/sk-[A-Za-z0-9_-]{20,}/);
 assert.equal(bundle.redaction.promptsStored,false);
 assert.equal(bundle.redaction.answersStored,false);
});
