import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_ENDPOINT_READINESS_MAX_AGE_MS,
  evaluateProviderEndpointReadiness
} from '../backend/provider-endpoint-readiness.mjs';

const asOf = '2026-10-09T18:20:00+05:30';

function validEvidence(patch = {}) {
  return {
    source: 'authenticated-readonly-probe',
    observedAt: '2026-10-09T18:00:00+05:30',
    credential: {
      name: 'GEMINI_API_KEY',
      keyPresent: true,
      digest: 'a'.repeat(64),
      acknowledgements: {
        declared: true,
        liveBindingReadback: true,
        boundedPropagationRetries: true
      }
    },
    project: {
      bindingVerified: true,
      id: 'toonverse-ai',
      number: '594612167862',
      tier: 'free',
      billingAccountAttached: false
    },
    endpoint: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      endpointVerified: true,
      redirectsBlocked: true,
      tlsVerified: true
    },
    model: {
      id: 'gemini-3.8-flash',
      profileVerified: true,
      methods: ['countTokens', 'generateContent']
    },
    usage: {
      countTokensNonbillableVerified: true,
      authoritativeReceiptGetVerified: true,
      billable: false,
      totalTokens: 42
    },
    privacy: {
      store: false,
      background: false,
      promptsPersisted: false,
      answersPersisted: false,
      retentionDays: 0
    },
    funding: {
      ownerSpendCapMicrousd: 0,
      paidRequestsAllowed: false,
      autoTopUp: false
    },
    runtime: {
      generationEnabled: false,
      providerCallsPermitted: false,
      activationAuthorized: false
    },
    ...patch
  };
}

test('complete readiness evidence verifies without authorizing provider use', () => {
  const result = evaluateProviderEndpointReadiness(validEvidence(), asOf);
  assert.equal(result.status, 'AUTHENTICATED_PROVIDER_ENDPOINT_VERIFIED');
  assert.equal(result.verified, true);
  assert.equal(result.providerCallsAllowed, false);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.zeroOwnerSpendBoundary, true);
  assert.equal(result.redaction.keyStored, false);
});

test('stale but complete evidence is historical-only', () => {
  const result = evaluateProviderEndpointReadiness(
    validEvidence({observedAt: '2026-10-08T17:19:59+05:30'}),
    asOf
  );
  assert.equal(result.status, 'HISTORICAL_PROVIDER_ENDPOINT_READINESS');
  assert.equal(result.historicalEvidenceValid, true);
  assert.equal(result.verified, false);
  assert.equal(result.activationAllowed, false);
});

test('project, credential, endpoint or nonbillable receipt gaps fail closed', () => {
  for (const patch of [
    {project: {...validEvidence().project, id: 'wrong'}},
    {credential: {...validEvidence().credential, acknowledgements: {declared: true}}},
    {endpoint: {...validEvidence().endpoint, redirectsBlocked: false}},
    {usage: {...validEvidence().usage, billable: true}},
    {funding: {...validEvidence().funding, ownerSpendCapMicrousd: 1}},
    {runtime: {...validEvidence().runtime, generationEnabled: true}}
  ]) {
    assert.equal(
      evaluateProviderEndpointReadiness(validEvidence(patch), asOf).verified,
      false
    );
  }
});

test('future observations and malformed model or project identifiers fail closed', () => {
  const future = evaluateProviderEndpointReadiness(
    validEvidence({observedAt: '2026-10-09T18:21:00+05:30'}),
    asOf
  );
  assert.equal(future.historicalEvidenceValid, false);
  assert.equal(future.verified, false);
  assert.equal(
    evaluateProviderEndpointReadiness(
      validEvidence({model: {...validEvidence().model, id: 'gemini-pro'}}),
      asOf
    ).verified,
    false
  );
  assert.equal(PROVIDER_ENDPOINT_READINESS_MAX_AGE_MS, 86400000);
});

test('key, prompt, answer and raw provider response material is rejected and never returned', () => {
  const secret = 'private-key-never-print';
  const result = evaluateProviderEndpointReadiness(
    validEvidence({
      credential: {
        ...validEvidence().credential,
        keyValue: secret
      },
      rawResponse: 'private-response',
      prompt: 'private-prompt',
      answer: 'private-answer'
    }),
    asOf
  );
  assert.equal(result.verified, false);
  assert.equal(result.redaction.keyStored, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('private-response'), false);
});
