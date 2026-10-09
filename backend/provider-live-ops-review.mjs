import {evidenceIntegrityShape} from './provider-evidence-integrity.mjs';

const freeze=Object.freeze;

export const PROVIDER_LIVE_OPS_REVIEW_PROTOCOL='uvenaro-provider-live-ops-review-v1';

function dated(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}

export function evaluateProviderLiveOpsEvidence(evidence={}){
 const checks={
  sourceOperatorObserved:evidence.liveOpsSource==='operator-observed',
  reviewMarkedVerified:evidence.liveOpsEvidenceVerified===true,
  observedAt:dated(evidence.liveOpsObservedAt),
  alertDelivery:evidence.alertsVerified===true&&dated(evidence.alertsObservedAt),
  killSwitch:evidence.killSwitchVerified===true&&dated(evidence.killSwitchObservedAt),
  backupRestore:evidence.backupRestoreVerified===true&&dated(evidence.backupRestoreObservedAt),
  rollback:evidence.rollbackVerified===true&&evidence.versionPinned===true&&dated(evidence.rollbackObservedAt),
  integrity:Object.values(evidenceIntegrityShape(evidence.integrity)).every(Boolean)
 };
 return {protocol:PROVIDER_LIVE_OPS_REVIEW_PROTOCOL,ok:Object.values(checks).every(Boolean),checks};
}

export function requireProviderLiveOpsEvidence(evidence={}){
 const result=evaluateProviderLiveOpsEvidence(evidence);
 if(!result.ok)throw new Error('LIVE_OPERATIONS_EVIDENCE_REQUIRED');
 return freeze({...result});
}
