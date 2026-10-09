const freeze=Object.freeze;
import {evaluateIsolatedStagingReview} from './isolated-staging-review.mjs';
import {evaluateExactMainCiAttestation} from './isolated-staging-ci-attestation.mjs';

export const ISOLATED_STAGING_REAUDIT_PROTOCOL='uvenaro-isolated-staging-reaudit-v1';
export const READ_ONLY_REAUDIT_STEPS=freeze([
 'inventory',
 'schema-fingerprint',
 'private-binding-scope',
 'safe-off-runtime',
 'rollback-readiness'
]);

export function planIsolatedStagingReaudit({deployment={},ciAttestation={},ownerSpendMicrousd=deployment.ownerSpendMicrousd,asOf=new Date().toISOString()}={}){
 const ci=evaluateExactMainCiAttestation(ciAttestation);
 const staging=evaluateIsolatedStagingReview({...deployment,freshMainCiVerified:ci.exactMainCiGreen},asOf);
 const checks={
  ciAttested:ci.exactMainCiGreen,
  historicalDeploymentValid:staging.historicalEvidenceValid,
  safeOff:staging.safeOff,
  readOnly:true,
  remoteWritesDisabled:deployment.remoteChangesPerformed!==true,
  providerCallsDisabled:deployment.providerCallsPermitted===false,
  ownerSpendZero:ownerSpendMicrousd===0
 };
 const eligible=Object.values(checks).every(Boolean);
 return {
  protocol:ISOLATED_STAGING_REAUDIT_PROTOCOL,
  mode:'read-only',
  steps:[...READ_ONLY_REAUDIT_STEPS],
  eligible,
  writeAllowed:false,
  providerCallsAllowed:false,
  activationAllowed:false,
  checks,
  ci,
  staging
 };
}

export function requireReadOnlyStagingReauditPlan(input={}){
 const result=planIsolatedStagingReaudit(input);
 if(!result.eligible)throw new Error('READ_ONLY_STAGING_REAUDIT_REQUIRED');
 return freeze({...result});
}
