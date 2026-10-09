const freeze = Object.freeze;

export const WORKERS_FREE_PLAN_EVIDENCE_PROTOCOL =
  'uvenaro-workers-free-plan-evidence-v1';
export const WORKERS_FREE_PLAN_EVIDENCE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

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

  const verified = Object.values(checks).every(Boolean);
  return {
    protocol: WORKERS_FREE_PLAN_EVIDENCE_PROTOCOL,
    status: verified
      ? 'OWNER_DASHBOARD_FREE_PLAN_VERIFIED'
      : 'FREE_PLAN_EVIDENCE_UNVERIFIED',
    verified,
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

export function requireWorkersFreePlanEvidence(evidence = {}, asOf) {
  const result = evaluateWorkersFreePlanEvidence(evidence, asOf);
  if (!result.verified) throw new Error('WORKERS_FREE_PLAN_EVIDENCE_UNVERIFIED');
  return freeze({...result});
}
