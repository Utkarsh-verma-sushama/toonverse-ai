import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getProviderContract} from '../backend/provider-contract.mjs';
import {evaluateProviderAcceptance} from '../backend/provider-acceptance.mjs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/provider-acceptance/evidence.json',import.meta.url),'utf8'));

test('sanitized evidence bundle records current Free/no-billing safe-off state only',()=>{
 assert.equal(bundle.protocol,'uvenaro-provider-evidence-v1');
 assert.equal(bundle.provider,'google-gemini');
 assert.equal(bundle.project.id,'toonverse-ai');
 assert.equal(bundle.tier.name,'free');
 assert.equal(bundle.billing.configured,false);
 assert.equal(bundle.runtime.generationEnabled,false);
 assert.equal(bundle.runtime.activationAuthorized,false);
 assert.equal(bundle.runtime.providerRequestsPermitted,false);
 assert.equal(bundle.redaction.secretValuesStored,false);
 assert.equal(bundle.redaction.promptsStored,false);
 assert.equal(bundle.redaction.answersStored,false);
});

test('evidence bundle cannot silently become provider acceptance',()=>{
 const report=evaluateProviderAcceptance({
  contract:getProviderContract(bundle.provider),
  evidence:bundle.evidence,
  runtime:bundle.runtime
 });
 assert.equal(report.status,'SAFE_OFF_PENDING');
 assert.equal(report.providerAcceptanceVerified,false);
 assert.equal(report.activationAuthorized,false);
 assert.equal(report.generationAllowed,false);
 assert.ok(report.blockers.includes('MODEL_AND_CAPABILITY'));
 assert.ok(report.blockers.includes('PRICING_AND_ZERO_OWNER_SPEND'));
});

test('evidence bundle contains no credential-shaped material',()=>{
 const serialized=JSON.stringify(bundle);
 assert.doesNotMatch(serialized,/AIza[0-9A-Za-z_-]{20,}/);
 assert.doesNotMatch(serialized,/sk-[A-Za-z0-9_-]{20,}/);
 assert.doesNotMatch(serialized,/-----BEGIN [A-Z ]+ KEY-----/);
});
