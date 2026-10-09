import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKERS_FREE_PLAN_EVIDENCE_MAX_AGE_MS,
  evaluateWorkersFreePlanEvidence
} from '../backend/workers-free-plan-evidence.mjs';

const asOf = '2026-10-09T17:44:00+05:30';
const accountId = 'fc3da7a1c1263e601d03d222b7d1e155';
const digest = 'a'.repeat(64);

function validEvidence(patch = {}) {
  return {
    source: 'owner-dashboard',
    expectedAccountId: accountId,
    accountId,
    capturedAt: '2026-10-09T12:22:00+05:30',
    planLabel: 'Workers Free',
    monthlyPriceUsd: 0,
    billingEnabled: false,
    screenshotDigest: digest,
    ...patch
  };
}

test('fresh account-bound Workers Free evidence verifies without enabling anything', () => {
  const result = evaluateWorkersFreePlanEvidence(validEvidence(), asOf);
  assert.equal(result.status, 'OWNER_DASHBOARD_FREE_PLAN_VERIFIED');
  assert.equal(result.verified, true);
  assert.equal(result.provisioningAllowed, false);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.zeroOwnerSpendBoundary, true);
  assert.equal(result.redaction.screenshotStored, false);
});

test('evidence older than six hours or from the future fails closed', () => {
  const stale = evaluateWorkersFreePlanEvidence(
    validEvidence({capturedAt: '2026-10-09T11:43:59+05:30'}), asOf
  );
  assert.equal(stale.verified, false);
  const future = evaluateWorkersFreePlanEvidence(
    validEvidence({capturedAt: '2026-10-09T18:00:00+05:30'}), asOf
  );
  assert.equal(future.verified, false);
  assert.equal(WORKERS_FREE_PLAN_EVIDENCE_MAX_AGE_MS, 21600000);
});

test('wrong account, paid state, nonzero price or malformed digest fails closed', () => {
  for (const patch of [
    {accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},
    {planLabel: 'Workers Pro'},
    {monthlyPriceUsd: 1},
    {billingEnabled: true},
    {screenshotDigest: 'not-a-sha256'}
  ]) {
    assert.equal(evaluateWorkersFreePlanEvidence(validEvidence(patch), asOf).verified, false);
  }
});

test('raw screenshot or secret content is never accepted or retained', () => {
  const result = evaluateWorkersFreePlanEvidence(
    validEvidence({rawImageBase64: 'private-image', secretValue: 'private-token'}),
    asOf
  );
  assert.equal(result.verified, false);
  assert.equal(result.redaction.rawImageStored, false);
  assert.equal(result.redaction.secretStored, false);
});
