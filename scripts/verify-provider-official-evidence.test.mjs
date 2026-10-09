import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ledger=JSON.parse(readFileSync(new URL('../deploy/provider-acceptance/official-evidence.json',import.meta.url),'utf8'));

test('official evidence ledger is sanitized and remains non-authorizing',()=>{
 assert.equal(ledger.protocol,'uvenaro-provider-official-evidence-v1');
 assert.equal(ledger.sourceClass,'official-google-documentation');
 assert.equal(ledger.acceptanceDecision.status,'SAFE_OFF_PENDING');
 assert.equal(ledger.acceptanceDecision.generationEnabled,false);
 assert.equal(ledger.acceptanceDecision.providerRequestsPermitted,false);
 assert.equal(ledger.acceptanceDecision.activationAuthorized,false);
 assert.equal(ledger.findings.model.projectEndpointVerified,false);
 assert.equal(ledger.findings.pricing.projectPriceBindingVerified,false);
 assert.equal(ledger.findings.privacy.storeFalseAvailable,true);
 assert.equal(ledger.findings.privacy.backgroundExecutionAllowedByDefault,false);
 assert.deepEqual(ledger.findings.usage.interactionUsageFields,[
  'total_input_tokens','total_output_tokens','total_thought_tokens',
  'total_cached_tokens','total_tool_use_tokens','total_tokens'
 ]);
});

test('official evidence ledger contains no credential or user-content material',()=>{
 const serialized=JSON.stringify(ledger);
 assert.equal(/AIza[0-9A-Za-z_-]{20,}/.test(serialized),false);
 assert.equal(/sk-[0-9A-Za-z]{20,}/.test(serialized),false);
 assert.equal(/BEGIN (RSA|OPENSSH|EC) PRIVATE KEY/.test(serialized),false);
 assert.equal(ledger.redaction.secretValuesStored,false);
 assert.equal(ledger.redaction.promptsStored,false);
 assert.equal(ledger.redaction.answersStored,false);
});
