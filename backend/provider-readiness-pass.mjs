const freeze=Object.freeze;

export const PROVIDER_READINESS_PASS_PROTOCOL='uvenaro-provider-readiness-pass-v1';

export function evaluateProviderReadinessPass(evidence={}){
 const checks={
  isolatedResources:evidence.isolatedResources===true,
  schemasApplied:evidence.schemasApplied===true,
  privateBindings:evidence.privateBindings===true,
  smokeDrill:evidence.smokeDrill===true,
  restartRecoveryDrill:evidence.restartRecoveryDrill===true,
  rollbackDrill:evidence.rollbackDrill===true,
  generationDisabled:evidence.generationEnabled===false,
  paidConfirmationDisabled:evidence.paidConfirmation===false,
  apiKeyAbsent:evidence.apiKeyPresent===false,
  externalCallsDisabled:evidence.externalProviderCalls===false,
  publicEndpointDisabled:evidence.publicEndpoint===false,
  backgroundAiDisabled:evidence.backgroundAi===false,
  unknownOutcomesFailClosed:evidence.unknownOutcomeFailsClosed===true
 };
 return {
  protocol:PROVIDER_READINESS_PASS_PROTOCOL,
  readyForIsolatedFixture:Object.values(checks).every(Boolean),
  activationAllowed:false,
  checks
 };
}

export function requireProviderReadinessPass(evidence={}){
 const result=evaluateProviderReadinessPass(evidence);
 if(!result.readyForIsolatedFixture)throw new Error('PROVIDER_READINESS_INCOMPLETE');
 return freeze({...result});
}
