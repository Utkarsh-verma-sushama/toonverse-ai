const freeze=Object.freeze;

export const ISOLATED_STAGING_CI_ATTESTATION_PROTOCOL='uvenaro-isolated-staging-ci-attestation-v1';
export const REQUIRED_MAIN_CI_WORKFLOWS=freeze([
 'Cloud runtime validation',
 'Security policy gate',
 'Native build validation',
 'pages build and deployment'
]);
const SHA=/^[0-9a-f]{40}$/i;

export function evaluateExactMainCiAttestation(attestation={}){
 const workflows=Array.isArray(attestation.workflows)?attestation.workflows:[];
 const byName=new Map(workflows.map(item=>[item.name,item]));
 const checks={
  protocol:attestation.protocol===ISOLATED_STAGING_CI_ATTESTATION_PROTOCOL,
  branch:attestation.branch==='main',
  headSha:SHA.test(attestation.headSha||''),
  everyRequiredWorkflow:REQUIRED_MAIN_CI_WORKFLOWS.every(name=>{
   const item=byName.get(name);
   return item?.headSha===attestation.headSha&&item?.status==='completed'&&item?.conclusion==='success'&&typeof item?.runId==='number'&&item.runId>0;
  }),
  noDuplicateWorkflowNames:new Set(workflows.map(item=>item.name)).size===workflows.length,
  providerCallsDisabled:attestation.providerCallsPerformed===false,
  productionDisabled:attestation.productionActivated===false,
  ownerSpendZero:attestation.ownerSpendMicrousd===0
 };
 return {
  protocol:ISOLATED_STAGING_CI_ATTESTATION_PROTOCOL,
  exactMainCiGreen:Object.values(checks).every(Boolean),
  stagingReauditEligible:Object.values(checks).every(Boolean),
  activationAllowed:false,
  checks
 };
}

export function requireExactMainCiAttestation(attestation={}){
 const result=evaluateExactMainCiAttestation(attestation);
 if(!result.exactMainCiGreen)throw new Error('EXACT_MAIN_CI_ATTESTATION_REQUIRED');
 return freeze({...result});
}
