import {evaluateProviderAcceptance} from './provider-acceptance.mjs';

export const PROVIDER_ACTIVATION_REVIEW_PROTOCOL='uvenaro-provider-activation-review-v1';

export const EVIDENCE_FRESHNESS_WINDOWS_MS=Object.freeze({
 PROJECT_AND_TIER:24*60*60*1000,
 MODEL_AND_CAPABILITY:24*60*60*1000,
 PRICING_AND_ZERO_OWNER_SPEND:6*60*60*1000,
 PRIVACY_RETENTION_AND_REGION:30*24*60*60*1000,
 PREFLIGHT_AND_USAGE_ACCOUNTING:24*60*60*1000,
 RECONCILIATION_AND_RETRY_POLICY:7*24*60*60*1000,
 OPERATIONS_AND_ROLLBACK:7*24*60*60*1000
});

const GATE_DATE_PATHS=Object.freeze({
 PROJECT_AND_TIER:[['project','observedAt'],['tier','observedAt']],
 MODEL_AND_CAPABILITY:[['model','profileObservedAt'],['model','endpointObservedAt']],
 PRICING_AND_ZERO_OWNER_SPEND:[['pricing','snapshotAt'],['funding','observedAt']],
 PRIVACY_RETENTION_AND_REGION:[['privacy','reviewedAt'],['privacy','retentionReviewedAt'],['privacy','regionReviewedAt'],['privacy','agePolicyReviewedAt']],
 PREFLIGHT_AND_USAGE_ACCOUNTING:[['usage','countTokensObservedAt'],['usage','preflightObservedAt'],['usage','thinkingOutputObservedAt']],
 RECONCILIATION_AND_RETRY_POLICY:[['reconciliation','lostResponseObservedAt'],['reconciliation','retryPolicyObservedAt'],['reconciliation','receiptIdentityObservedAt']],
 OPERATIONS_AND_ROLLBACK:[['operations','alertsObservedAt'],['operations','backupRestoreObservedAt'],['operations','rollbackObservedAt']]
});

function dated(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function valueAt(root,path){return path.reduce((value,key)=>value&&typeof value==='object'?value[key]:undefined,root);}
function authorizationRecordValid(record={}){
 return record.activationAuthorized===true&&typeof record.approvedBy==='string'&&record.approvedBy.trim().length>=3&&
  dated(record.approvedAt)&&typeof record.scope==='string'&&record.scope==='provider-generation'&&
  typeof record.reason==='string'&&record.reason.trim().length>=8;
}

function freshnessForGate(gate,evidence,asOf){
 const paths=GATE_DATE_PATHS[gate.id]||[];
 const values=paths.map(path=>valueAt(evidence,path)).filter(value=>value!==undefined);
 if(values.length!==paths.length)return {id:gate.id,status:'missing',reason:'every evidence item needs a dated observation'};
 if(values.some(value=>!dated(value)))return {id:gate.id,status:'invalid',reason:'evidence observation date is invalid'};
 const ages=values.map(value=>Date.parse(asOf)-Date.parse(value));
 if(ages.some(age=>age<0))return {id:gate.id,status:'future',reason:'evidence observation cannot be after review time'};
 const ageMs=Math.max(...ages);
 const windowMs=EVIDENCE_FRESHNESS_WINDOWS_MS[gate.id];
 return {id:gate.id,status:ageMs<=windowMs?'fresh':'stale',ageMs,windowMs,reason:ageMs<=windowMs?'within freshness window':'fresh evidence required'};
}

export function reviewProviderActivation({contract,evidence={},runtime={},asOf=new Date().toISOString()}={}){
 const acceptance=evaluateProviderAcceptance({contract,evidence,runtime});
 const freshness=acceptance.gates.map(gate=>freshnessForGate(gate,evidence,asOf));
 const freshnessBlockers=freshness.filter(item=>item.status!=='fresh').map(item=>item.id);
 const authorizationValid=authorizationRecordValid(evidence.authorization);
 const safeOff=runtime.generationEnabled!==true&&runtime.providerRequestsPermitted!==true;
 const blockers=[...new Set([...acceptance.blockers,...freshnessBlockers])];
 if(!authorizationValid&&runtime.activationAuthorized===true)blockers.push('AUTHORIZATION_RECORD');
 let status='SAFE_OFF_PENDING';
 if(runtime.generationEnabled===true||runtime.providerRequestsPermitted===true){
  status=blockers.length||!authorizationValid?'REJECTED':'AUTHORIZED_BUT_NOT_EXECUTING';
 }else if(blockers.length===0&&safeOff){
  status='READY_FOR_EXPLICIT_AUTHORIZATION';
 }
 return {
  protocol:PROVIDER_ACTIVATION_REVIEW_PROTOCOL,
  asOf,
  status,
  activationEligible:status==='READY_FOR_EXPLICIT_AUTHORIZATION',
  executionPermitted:status==='AUTHORIZED_BUT_NOT_EXECUTING',
  safeOff,
  authorizationRecordValid:authorizationValid,
  acceptance,
  freshness,
  blockers:[...new Set(blockers)]
 };
}
