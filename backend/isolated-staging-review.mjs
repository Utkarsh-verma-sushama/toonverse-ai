const freeze=Object.freeze;

export const ISOLATED_STAGING_REVIEW_PROTOCOL='uvenaro-isolated-staging-review-v1';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40,64}$/i;

export function evaluateIsolatedStagingReview(record={},asOf=new Date().toISOString()){
 const dbs=Array.isArray(record.databases)?record.databases:[];
 const workers=Array.isArray(record.workers)?record.workers:[];
 const checks={
  protocol:record.protocol==='uvenaro-verified-private-isolated-deployment-v1',
  accountBound:typeof record.accountId==='string'&&record.accountId.length>=16,
  sourceCommit:SHA.test(record.sourceCommit||''),
  workflowVerified:Number.isSafeInteger(record.workflowRunId)&&record.workflowRunId>0,
  verifiedAt:typeof record.verifiedAt==='string'&&Number.isFinite(Date.parse(record.verifiedAt)),
  threeDatabaseRoles:dbs.length===3&&new Set(dbs.map(db=>db.role)).size===3&&dbs.every(db=>UUID.test(db.uuid||'')),
  workersVersionPinned:workers.length===2&&workers.every(worker=>worker.deployment?.versions?.length===1&&worker.deployment.versions[0].percentage===100),
  privateEndpoints:record.privateEndpointsVerified===true,
  secretScopes:record.secretScopesVerified===true,
  safeOff:record.providerCallsPermitted===false&&record.productionActivated===false&&record.publicLaunchAccepted===false,
  blankModelRestored:record.journal?.workersRestoredToBlankModel===true&&record.journal?.probeRemoved===true,
  rollbackEvidence:record.journal?.resumedFrom&&record.journal?.manifestSha256,
  freshMainCiVerified:record.freshMainCiVerified===true
 };
 const historicalEvidenceValid=Object.entries(checks).filter(([key])=>key!=='freshMainCiVerified').every(([,value])=>Boolean(value));
 const verifiedAt=Date.parse(record.verifiedAt),age=Date.parse(asOf)-verifiedAt;
 const fresh=Number.isFinite(age)&&age>=0&&age<=7*24*60*60*1000;
 return {
  protocol:ISOLATED_STAGING_REVIEW_PROTOCOL,
  historicalEvidenceValid,
  stagingReauditEligible:historicalEvidenceValid&&fresh&&checks.freshMainCiVerified,
  activationAllowed:false,
  safeOff:checks.safeOff,
  freshness:{fresh,ageMs:age,windowMs:7*24*60*60*1000},
  checks
 };
}

export function requireIsolatedStagingReaudit(record={},asOf=new Date().toISOString()){
 const result=evaluateIsolatedStagingReview(record,asOf);
 if(!result.stagingReauditEligible)throw new Error('ISOLATED_STAGING_REAUDIT_REQUIRED');
 return freeze({...result});
}
