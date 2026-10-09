const freeze = Object.freeze;

export const WORKERS_FREE_PLAN_EVIDENCE_PROTOCOL =
  'uvenaro-workers-free-plan-evidence-v1';
export const WORKERS_FREE_PLAN_EVIDENCE_BUNDLE_PROTOCOL =
  'uvenaro-workers-free-plan-evidence-bundle-v1';
export const WORKERS_FREE_PLAN_EVIDENCE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const WORKERS_FREE_PLAN_EVIDENCE_MAX_CAPTURES = 4;
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const CAPTURE_KINDS = new Set(['account-identity', 'workers-plan']);

export function evaluateWorkersFreePlanEvidence(
  evidence = {},
  asOf = new Date().toISOString()
) {
  const expectedAccountId = evidence.expectedAccountId || '';
  const capturedAt = Date.parse(evidence.capturedAt || '');
  const observedAt = Date.parse(asOf);
  const ageMs = observedAt - capturedAt;
  const planLabel = String(evidence.planLabel || '').trim().toLowerCase();

  const checks = {
    source: evidence.source === 'owner-dashboard',
    accountBound: ACCOUNT_ID.test(expectedAccountId) &&
      evidence.accountId === expectedAccountId,
    capturedAt: Number.isFinite(capturedAt),
    captureNotFuture: Number.isFinite(capturedAt) &&
      Number.isFinite(observedAt) &&
      capturedAt <= observedAt,
    fresh: Number.isFinite(ageMs) &&
      ageMs >= 0 &&
      ageMs <= WORKERS_FREE_PLAN_EVIDENCE_MAX_AGE_MS,
    freePlanLabel: /\bfree\b/.test(planLabel) &&
      /workers|cloudflare/.test(planLabel),
    zeroMonthlyPrice: evidence.monthlyPriceUsd === 0,
    billingInactive: evidence.billingEnabled === false,
    screenshotDigest: SHA256.test(evidence.screenshotDigest || ''),
    noRawContent: evidence.rawImageBase64 === undefined &&
      evidence.rawScreenshot === undefined &&
      evidence.secretValue === undefined
  };

  const historicalEvidenceValid = Object.entries(checks)
    .filter(([name]) => name !== 'fresh')
    .every(([, passed]) => passed);
  const verified = historicalEvidenceValid && checks.fresh;

  return {
    protocol: WORKERS_FREE_PLAN_EVIDENCE_PROTOCOL,
    status: verified
      ? 'OWNER_DASHBOARD_FREE_PLAN_VERIFIED'
      : historicalEvidenceValid
        ? 'HISTORICAL_OWNER_DASHBOARD_FREE_PLAN_EVIDENCE'
        : 'FREE_PLAN_EVIDENCE_UNVERIFIED',
    verified,
    historicalEvidenceValid,
    apiIndependent: false,
    provisioningAllowed: false,
    activationAllowed: false,
    zeroOwnerSpendBoundary: true,
    checks,
    freshness: {
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      maxAgeMs: WORKERS_FREE_PLAN_EVIDENCE_MAX_AGE_MS
    },
    redaction: {
      screenshotStored: false,
      rawImageStored: false,
      secretStored: false,
      promptStored: false,
      answerStored: false
    }
  };
}

function evaluateBundleCapture(capture = {}, expectedAccountId, observedAt) {
  const kind = capture.kind;
  const capturedAt = Date.parse(capture.capturedAt || '');
  const ageMs = observedAt - capturedAt;
  const planLabel = String(capture.planLabel || '').trim().toLowerCase();
  const accountIdProvided = capture.accountId !== undefined;

  const checks = {
    kind: CAPTURE_KINDS.has(kind),
    source: capture.source === 'owner-dashboard',
    accountBound: !accountIdProvided ||
      (ACCOUNT_ID.test(expectedAccountId) && capture.accountId === expectedAccountId),
    accountIdentity: kind === 'account-identity' &&
      ACCOUNT_ID.test(expectedAccountId) &&
      capture.accountId === expectedAccountId,
    planEvidence: kind === 'workers-plan' &&
      /\bfree\b/.test(planLabel) &&
      /workers|cloudflare/.test(planLabel) &&
      capture.monthlyPriceUsd === 0 &&
      capture.billingEnabled === false,
    capturedAt: Number.isFinite(capturedAt),
    captureNotFuture: Number.isFinite(capturedAt) &&
      Number.isFinite(observedAt) &&
      capturedAt <= observedAt,
    fresh: Number.isFinite(ageMs) &&
      ageMs >= 0 &&
      ageMs <= WORKERS_FREE_PLAN_EVIDENCE_MAX_AGE_MS,
    screenshotDigest: SHA256.test(capture.screenshotDigest || ''),
    noRawContent: capture.rawImageBase64 === undefined &&
      capture.rawScreenshot === undefined &&
      capture.secretValue === undefined &&
      capture.prompt === undefined &&
      capture.answer === undefined
  };

  const kindEvidenceValid = kind === 'account-identity'
    ? checks.accountIdentity
    : kind === 'workers-plan'
      ? checks.planEvidence
      : false;
  const historicalEvidenceValid =
    checks.kind &&
    checks.source &&
    checks.accountBound &&
    kindEvidenceValid &&
    checks.capturedAt &&
    checks.captureNotFuture &&
    checks.screenshotDigest &&
    checks.noRawContent;

  return {
    kind,
    historicalEvidenceValid,
    verified: historicalEvidenceValid && checks.fresh,
    checks,
    freshness: {
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      maxAgeMs: WORKERS_FREE_PLAN_EVIDENCE_MAX_AGE_MS
    }
  };
}

export function evaluateWorkersFreePlanEvidenceBundle(
  bundle = {},
  asOf = new Date().toISOString()
) {
  const expectedAccountId = bundle.expectedAccountId || '';
  const observedAt = Date.parse(asOf);
  const captures = Array.isArray(bundle.captures)
    ? bundle.captures.slice(0, WORKERS_FREE_PLAN_EVIDENCE_MAX_CAPTURES)
    : [];
  const captureResults = captures.map((capture) =>
    evaluateBundleCapture(capture, expectedAccountId, observedAt)
  );
  const hasExpectedAccount = ACCOUNT_ID.test(expectedAccountId);
  const hasAccountIdentity = captureResults.some((result) =>
    result.kind === 'account-identity' &&
    result.checks.accountIdentity
  );
  const hasWorkersPlan = captureResults.some((result) =>
    result.kind === 'workers-plan' &&
    result.checks.planEvidence
  );
  const allHistorical = captures.length > 0 &&
    captures.length <= WORKERS_FREE_PLAN_EVIDENCE_MAX_CAPTURES &&
    hasExpectedAccount &&
    hasAccountIdentity &&
    hasWorkersPlan &&
    captureResults.every((result) => result.historicalEvidenceValid);
  const allFresh = allHistorical &&
    captureResults.every((result) => result.checks.fresh);
  const verified = allFresh;

  return {
    protocol: WORKERS_FREE_PLAN_EVIDENCE_BUNDLE_PROTOCOL,
    status: verified
      ? 'OWNER_DASHBOARD_FREE_PLAN_BUNDLE_VERIFIED'
      : allHistorical
        ? 'HISTORICAL_OWNER_DASHBOARD_FREE_PLAN_BUNDLE'
        : 'FREE_PLAN_EVIDENCE_BUNDLE_UNVERIFIED',
    verified,
    historicalEvidenceValid: allHistorical,
    apiIndependent: false,
    provisioningAllowed: false,
    activationAllowed: false,
    zeroOwnerSpendBoundary: true,
    checks: {
      expectedAccount: hasExpectedAccount,
      hasAccountIdentity,
      hasWorkersPlan,
      captureCount: captures.length,
      allHistorical,
      allFresh
    },
    captures: captureResults.map((result) => ({
      kind: result.kind,
      historicalEvidenceValid: result.historicalEvidenceValid,
      verified: result.verified,
      checks: result.checks,
      freshness: result.freshness
    })),
    redaction: {
      screenshotStored: false,
      rawImageStored: false,
      secretStored: false,
      promptStored: false,
      answerStored: false
    }
  };
}

export function requireWorkersFreePlanEvidence(evidence = {}, asOf) {
  const result = evaluateWorkersFreePlanEvidence(evidence, asOf);
  if (!result.verified) throw new Error('WORKERS_FREE_PLAN_EVIDENCE_UNVERIFIED');
  return freeze({...result});
}

export function requireWorkersFreePlanEvidenceBundle(bundle = {}, asOf) {
  const result = evaluateWorkersFreePlanEvidenceBundle(bundle, asOf);
  if (!result.verified) {
    throw new Error('WORKERS_FREE_PLAN_EVIDENCE_BUNDLE_UNVERIFIED');
  }
  return freeze({...result});
}
