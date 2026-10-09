import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/isolated-staging/reaudit-plan.json',import.meta.url),'utf8'));

test('re-audit plan is eligible but not executed or authorizing',()=>{
 assert.equal(bundle.protocol,'uvenaro-isolated-staging-reaudit-v1');
 assert.equal(bundle.mode,'read-only');
 assert.equal(bundle.eligible,true);
 assert.equal(bundle.writeAllowed,false);
 assert.equal(bundle.providerCallsAllowed,false);
 assert.equal(bundle.activationAllowed,false);
 assert.equal(bundle.decision.executed,false);
 assert.equal(bundle.ownerSpendMicrousd,0);
});

test('re-audit plan is sanitized',()=>{
 const serialized=JSON.stringify(bundle);
 assert.doesNotMatch(serialized,/AIza[0-9A-Za-z_-]{20,}/);
 assert.doesNotMatch(serialized,/sk-[A-Za-z0-9_-]{20,}/);
 assert.equal(bundle.redaction.promptsStored,false);
 assert.equal(bundle.redaction.answersStored,false);
 assert.equal(bundle.redaction.rawResponsesStored,false);
});
