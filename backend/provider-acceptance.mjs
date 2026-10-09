const freeze=Object.freeze;

export const PROVIDER_ACCEPTANCE_PROTOCOL='uvenaro-provider-acceptance-v1';

export const REQUIRED_PROVIDER_GATES=freeze([
 'PROJECT_AND_TIER',
 'MODEL_AND_CAPABILITY',
 'PRICING_AND_ZERO_OWNER_SPEND',
 'PRIVACY_RETENTION_AND_REGION',
 'PREFLIGHT_AND_USAGE_ACCOUNTING',
 'RECONCILIATION_AND_RETRY_POLICY',
 'OPERATIONS_AND_ROLLBACK'
]);

const passed=(id,ok,reason)=>({id,status:ok?'pass':'pending',reason});

function dated(value){
 return typeof value==='string'&&Number.isFinite(Date.parse(value));
}

function completeEvidence(evidence={}){
 const project=evidence.project||{},tier=evidence.tier||{},model=evidence.model||{},
  pricing=evidence.pricing||{},funding=evidence.funding||{},privacy=evidence.privacy||{},
  usage=evidence.usage||{},reconciliation=evidence.reconciliation||{},operations=evidence.operations||{};
 return [
  passed('PROJECT_AND_TIER',
   project.bindingVerified===true&&tier.verified===true&&typeof tier.name==='string'&&dated(tier.observedAt),
   'dated project binding and tier evidence required'),
  passed('MODEL_AND_CAPABILITY',
   model.profileVerified===true&&model.endpointVerified===true&&Array.isArray(model.methods)&&
    model.methods.includes('countTokens')&&model.methods.includes('generateContent'),
   'audited model profile and endpoint capability evidence required'),
  passed('PRICING_AND_ZERO_OWNER_SPEND',
   pricing.snapshotVerified===true&&dated(pricing.snapshotAt)&&
    funding.sourceVerified===true&&funding.zeroOwnerSpendBoundary===true,
   'dated pricing and funded zero-owner-spend evidence required'),
  passed('PRIVACY_RETENTION_AND_REGION',
   privacy.privacyReviewed===true&&privacy.retentionReviewed===true&&
    privacy.regionReviewed===true&&privacy.agePolicyReviewed===true,
   'privacy, retention, region and age-policy evidence required'),
  passed('PREFLIGHT_AND_USAGE_ACCOUNTING',
   usage.countTokensNonbillableVerified===true&&usage.preflightHeadroomVerified===true&&
    usage.thinkingOutputAccountingVerified===true,
   'preflight, nonbillable count and thinking/output accounting evidence required'),
  passed('RECONCILIATION_AND_RETRY_POLICY',
   reconciliation.lostResponsePolicyVerified===true&&
    reconciliation.noAutomaticRetryVerified===true&&reconciliation.receiptIdentityVerified===true,
   'lost-response, retry and receipt-identity evidence required'),
  passed('OPERATIONS_AND_ROLLBACK',
   operations.alertsVerified===true&&operations.backupRestoreVerified===true&&
    operations.rollbackVerified===true,
   'alerts, backup/restore and rollback evidence required')
 ];
}

export function evaluateProviderAcceptance({contract,evidence={},runtime={}}={}){
 const errors=[];
 if(!contract||contract.protocol!=='bounded-metered-v1')errors.push('CONTRACT_UNAVAILABLE');
 const gates=completeEvidence(evidence);
 const blockers=gates.filter(gate=>gate.status!=='pass').map(gate=>gate.id);
 const requested=runtime.generationEnabled===true||runtime.activationAuthorized===true;
 const explicitAuthorization=evidence.authorization?.activationAuthorized===true;
 if(requested&&!explicitAuthorization)errors.push('ACTIVATION_AUTHORIZATION_REQUIRED');
 if(requested&&blockers.length)errors.push('ACTIVATION_GATES_INCOMPLETE');
 const allPassed=blockers.length===0&&errors.length===0;
 let status='SAFE_OFF_PENDING';
 if(requested&&errors.length)status='REJECTED';
 else if(allPassed&&!explicitAuthorization)status='READY_FOR_AUTHORIZED_ACTIVATION';
 else if(allPassed&&explicitAuthorization)status='ACTIVATION_AUTHORIZED';
 return {
  protocol:PROVIDER_ACCEPTANCE_PROTOCOL,
  status,
  providerAcceptanceVerified:allPassed,
  activationAuthorized:status==='ACTIVATION_AUTHORIZED',
  generationAllowed:status==='ACTIVATION_AUTHORIZED',
  gates,
  blockers,
  errors
 };
}
