import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKERS_FREE_PLAN_EVIDENCE_MAX_CAPTURES,
  evaluateWorkersFreePlanEvidenceBundle
} from '../backend/workers-free-plan-evidence.mjs';

const asOf = '2026-10-09T18:00:00+05:30';
const accountId = 'fc3da7a1c1263e601d03d222b7d1e155';

function capture(kind, patch = {}) {
  return {
    kind,
    source: 'owner-dashboard',
    capturedAt: '2026-10-09T17:30:00+05:30',
    screenshotDigest: 'a'.repeat(64),
    ...(kind === 'account-identity'
      ? {accountId}
      : {
          planLabel: 'Workers Free',
          monthlyPriceUsd: 0,
          billingEnabled: false
        }),
    ...patch
  };
}

function validBundle(patch = {}) {
  return {
    expectedAccountId: accountId,
    captures: [
      capture('account-identity'),
      capture('workers-plan', {screenshotDigest: 'b'.repeat(64)})
    ],
    ...patch
  };
}

test('fresh split dashboard captures verify as one Free-plan bundle without enabling anything', () => {
  const result = evaluateWorkersFreePlanEvidenceBundle(validBundle(), asOf);
  assert.equal(result.status, 'OWNER_DASHBOARD_FREE_PLAN_BUNDLE_VERIFIED');
  assert.equal(result.verified, true);
  assert.equal(result.historicalEvidenceValid, true);
  assert.equal(result.checks.hasAccountIdentity, true);
  assert.equal(result.checks.hasWorkersPlan, true);
  assert.equal(result.provisioningAllowed, false);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.zeroOwnerSpendBoundary, true);
  assert.equal(result.redaction.screenshotStored, false);
});

test('stale split captures remain historical-only and cannot close the current gate', () => {
  const result = evaluateWorkersFreePlanEvidenceBundle(validBundle({
    captures: [
      capture('account-identity', {capturedAt: '2026-10-09T11:59:59+05:30'}),
      capture('workers-plan', {
        capturedAt: '2026-10-09T11:59:59+05:30',
        screenshotDigest: 'b'.repeat(64)
      })
    ]
  }), asOf);
  assert.equal(result.status, 'HISTORICAL_OWNER_DASHBOARD_FREE_PLAN_BUNDLE');
  assert.equal(result.historicalEvidenceValid, true);
  assert.equal(result.verified, false);
  assert.equal(result.provisioningAllowed, false);
  assert.equal(result.activationAllowed, false);
});

test('missing identity, wrong account, malformed digest or raw content fails closed', () => {
  for (const patch of [
    {captures: [capture('workers-plan')]},
    {captures: [
      capture('account-identity', {accountId: 'a'.repeat(32)}),
      capture('workers-plan', {screenshotDigest: 'b'.repeat(64)})
    ]},
    {captures: [
      capture('account-identity'),
      capture('workers-plan', {screenshotDigest: 'not-a-sha256'})
    ]},
    {captures: [
      capture('account-identity', {rawScreenshot: 'private-image'}),
      capture('workers-plan', {screenshotDigest: 'b'.repeat(64)})
    ]}
  ]) {
    assert.equal(
      evaluateWorkersFreePlanEvidenceBundle(patch, asOf).verified,
      false
    );
  }
});

test('capture count is bounded and oversized bundles fail closed', () => {
  const captures = Array.from(
    {length: WORKERS_FREE_PLAN_EVIDENCE_MAX_CAPTURES + 1},
    (_, index) => index === 0
      ? capture('account-identity')
      : capture('workers-plan', {screenshotDigest: String(index).repeat(64)})
  );
  const result = evaluateWorkersFreePlanEvidenceBundle(
    validBundle({captures}),
    asOf
  );
  assert.equal(result.verified, false);
  assert.equal(result.checks.captureCount, WORKERS_FREE_PLAN_EVIDENCE_MAX_CAPTURES + 1);
});
