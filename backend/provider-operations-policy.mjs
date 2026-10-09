const freeze=Object.freeze;

export const PROVIDER_OPERATIONS_POLICY_PROTOCOL='uvenaro-provider-operations-policy-v1';

export const DEFAULT_PROVIDER_OPERATIONS_POLICY=freeze({
 killSwitchRequired:true,
 alertThresholds:freeze({
  errorRatePct:5,
  reconciliationOpen:1,
  latencyMs:30000,
  spendMicrousd:0
 }),
 backupRestoreRequired:true,
 rollbackMode:'version-pinned',
 automaticRetry:false,
 promptLogging:false,
 answerLogging:false,
 publicEndpoint:false
});

export function validateProviderOperationsPolicy(policy=DEFAULT_PROVIDER_OPERATIONS_POLICY){
 const errors=[];
 const check=(ok,code)=>{if(!ok)errors.push(code);};
 check(policy&&typeof policy==='object','OPERATIONS_POLICY_MISSING');
 if(!policy||typeof policy!=='object')return {ok:false,errors,policy};
 check(policy.killSwitchRequired===true,'KILL_SWITCH_REQUIRED');
 check(policy.backupRestoreRequired===true,'BACKUP_RESTORE_REQUIRED');
 check(policy.rollbackMode==='version-pinned','VERSION_PINNED_ROLLBACK_REQUIRED');
 check(policy.automaticRetry===false,'AUTOMATIC_RETRY_FORBIDDEN');
 check(policy.promptLogging===false,'PROMPT_LOGGING_FORBIDDEN');
 check(policy.answerLogging===false,'ANSWER_LOGGING_FORBIDDEN');
 check(policy.publicEndpoint===false,'PUBLIC_ENDPOINT_FORBIDDEN');
 const thresholds=policy.alertThresholds;
 check(thresholds&&thresholds.errorRatePct===5&&thresholds.reconciliationOpen===1&&
  thresholds.latencyMs===30000&&thresholds.spendMicrousd===0,'ALERT_THRESHOLDS_INVALID');
 return {ok:errors.length===0,errors,policy};
}

export function evaluateProviderOperationsEvidence(evidence={}){
 const checks={
  killSwitchVerified:evidence.killSwitchVerified===true,
  alertThresholdsDeclared:evidence.alertThresholdsDeclared===true,
  backupRestoreVerified:evidence.backupRestoreVerified===true,
  rollbackVerified:evidence.rollbackVerified===true,
  versionPinned:evidence.versionPinned===true,
  automaticRetryDisabled:evidence.automaticRetry===false,
  promptLoggingDisabled:evidence.promptLogging===false,
  answerLoggingDisabled:evidence.answerLogging===false,
  publicEndpointDisabled:evidence.publicEndpoint===false
 };
 return {ok:Object.values(checks).every(Boolean),checks};
}
