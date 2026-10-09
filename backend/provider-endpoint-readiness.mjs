const freeze = Object.freeze;

export const PROVIDER_ENDPOINT_READINESS_PROTOCOL =
  'uvenaro-provider-endpoint-readiness-v1';
export const PROVIDER_ENDPOINT_READINESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SHA256 = /^[a-f0-9]{64}$/i;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const PROJECT_NUMBER = /^\d{6,20}$/;
const MODEL_ID = /^gemini-3(?:\.\d+)?-(?:flash|flash-lite)$/;
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta';

function dated(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function noSecretMaterial(value = {}) {
  return value.keyValue === undefined &&
    value.apiKey === undefined &&
    value.secretValue === undefined &&
    value.rawResponse === undefined &&
    value.prompt === undefined &&
    value.answer === undefined;
}

export function evaluateProviderEndpointReadiness(
  evidence = {},
  asOf = new Date().toISOString()
) {
  const observedAt = Date.parse(asOf);
  const capturedAt = Date.parse(evidence.observedAt || '');
  const ageMs = observedAt - capturedAt;
  const credential = evidence.credential || {};
  const project = evidence.project || {};
  const endpoint = evidence.endpoint || {};
  const model = evidence.model || {};
  const usage = evidence.usage || {};
  const privacy = evidence.privacy || {};
  const funding = evidence.funding || {};
  const runtime = evidence.runtime || {};

  const checks = {
    source: evidence.source === 'authenticated-readonly-probe',
    observedAt: dated(evidence.observedAt),
    notFuture: Number.isFinite(capturedAt) &&
      Number.isFinite(observedAt) &&
      capturedAt <= observedAt,
    fresh: Number.isFinite(ageMs) &&
      ageMs >= 0 &&
      ageMs <= PROVIDER_ENDPOINT_READINESS_MAX_AGE_MS,
    credentialName: /^[A-Z][A-Z0-9_]{2,80}$/.test(credential.name || ''),
    credentialPresent: credential.keyPresent === true,
    credentialDigest: SHA256.test(credential.digest || ''),
    acknowledgements: credential.acknowledgements?.declared === true &&
      credential.acknowledgements?.liveBindingReadback === true &&
      credential.acknowledgements?.boundedPropagationRetries === true,
    projectBinding: project.bindingVerified === true &&
      PROJECT_ID.test(project.id || '') &&
      PROJECT_NUMBER.test(String(project.number || '')),
    tier: project.tier === 'free' &&
      project.billingAccountAttached === false,
    endpoint: endpoint.baseUrl === GEMINI_ENDPOINT &&
      endpoint.endpointVerified === true &&
      endpoint.redirectsBlocked === true &&
      endpoint.tlsVerified === true,
    model: MODEL_ID.test(model.id || '') &&
      model.profileVerified === true &&
      Array.isArray(model.methods) &&
      model.methods.includes('countTokens') &&
      model.methods.includes('generateContent'),
    nonbillableCount: usage.countTokensNonbillableVerified === true &&
      usage.authoritativeReceiptGetVerified === true &&
      usage.billable === false &&
      Number.isSafeInteger(usage.totalTokens) &&
      usage.totalTokens >= 0,
    privacy: privacy.store === false &&
      privacy.background === false &&
      privacy.promptsPersisted === false &&
      privacy.answersPersisted === false &&
      privacy.retentionDays === 0,
    zeroOwnerSpend: funding.ownerSpendCapMicrousd === 0 &&
      funding.paidRequestsAllowed === false &&
      funding.autoTopUp === false,
    safeOff: runtime.generationEnabled === false &&
      runtime.providerCallsPermitted === false &&
      runtime.activationAuthorized === false,
    noSecretMaterial: noSecretMaterial(evidence) &&
      noSecretMaterial(credential) &&
      noSecretMaterial(project) &&
      noSecretMaterial(endpoint) &&
      noSecretMaterial(model) &&
      noSecretMaterial(usage)
  };

  const historicalEvidenceValid = Object.entries(checks)
    .filter(([name]) => name !== 'fresh')
    .every(([, passed]) => passed);
  const verified = historicalEvidenceValid && checks.fresh;

  return {
    protocol: PROVIDER_ENDPOINT_READINESS_PROTOCOL,
    status: verified
      ? 'AUTHENTICATED_PROVIDER_ENDPOINT_VERIFIED'
      : historicalEvidenceValid
        ? 'HISTORICAL_PROVIDER_ENDPOINT_READINESS'
        : 'PROVIDER_ENDPOINT_READINESS_UNVERIFIED',
    verified,
    historicalEvidenceValid,
    providerCallsAllowed: false,
    activationAllowed: false,
    zeroOwnerSpendBoundary: true,
    checks,
    freshness: {
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      maxAgeMs: PROVIDER_ENDPOINT_READINESS_MAX_AGE_MS
    },
    redaction: {
      keyStored: false,
      rawResponseStored: false,
      promptStored: false,
      answerStored: false
    }
  };
}

export function requireProviderEndpointReadiness(evidence = {}, asOf) {
  const result = evaluateProviderEndpointReadiness(evidence, asOf);
  if (!result.verified) {
    throw new Error('PROVIDER_ENDPOINT_READINESS_UNVERIFIED');
  }
  return freeze({...result});
}
