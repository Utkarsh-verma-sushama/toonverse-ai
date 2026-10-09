import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/isolated-staging/reaudit-execution-ledger.json',import.meta.url),'utf8'));

test('fixture ledger is complete but has no remote side effects',()=>{
 assert.equal(bundle.protocol,'uvenaro-isolated-staging-reaudit-execution-v1');
 assert.equal(bundle.status,'FIXTURE_REAUDIT_PASS');
 assert.equal(bundle.complete,true);
 assert.equal(bundle.remoteExecutionPerformed,false);
 assert.equal(bundle.providerCallsPerformed,false);
 assert.equal(bundle.activationAllowed,false);
 assert.equal(bundle.ownerSpendMicrousd,0);
 assert.equal(bundle.steps.length,5);
});

test('fixture ledger is sanitized',()=>{
 const serialized=JSON.stringify(bundle);
 assert.doesNotMatch(serialized,/AIza[0-9A-Za-z_-]{20,}/);
 assert.doesNotMatch(serialized,/sk-[A-Za-z0-9_-]{20,}/);
 assert.equal(bundle.redaction.promptsStored,false);
 assert.equal(bundle.redaction.answersStored,false);
 assert.equal(bundle.redaction.rawResponsesStored,false);
});
