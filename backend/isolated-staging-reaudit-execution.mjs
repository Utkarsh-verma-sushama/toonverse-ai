const freeze=Object.freeze;

export const ISOLATED_STAGING_REAUDIT_EXECUTION_PROTOCOL='uvenaro-isolated-staging-reaudit-execution-v1';
export const REAUDIT_EXECUTION_STEPS=freeze([
 'inventory',
 'schema-fingerprint',
 'private-binding-scope',
 'safe-off-runtime',
 'rollback-readiness'
]);

export function executeReadOnlyStagingReaudit({plan={},observations=[]}={}){
 const rows=Array.isArray(observations)?observations:[];
 const byStep=new Map(rows.map(row=>[row.step,row]));
 const checks={
  planEligible:plan.protocol==='uvenaro-isolated-staging-reaudit-v1'&&plan.eligible===true,
  orderedSteps:JSON.stringify(plan.steps)===JSON.stringify(REAUDIT_EXECUTION_STEPS),
  everyStepObserved:REAUDIT_EXECUTION_STEPS.every(step=>{
   const row=byStep.get(step);
   return row?.passed===true&&(row.mode==='fixture' || row.mode==='read-only')&&
    row?.remoteWrite===false&&row?.providerCall===false;
  }),
  noDuplicateSteps:new Set(rows.map(row=>row.step)).size===rows.length,
  noWrites:rows.every(row=>row.remoteWrite===false),
  noProviderCalls:rows.every(row=>row.providerCall===false),
  safeOff:rows.every(row=>row.safeOff===true)
 };
 const complete=Object.values(checks).every(Boolean);
 return {
  protocol:ISOLATED_STAGING_REAUDIT_EXECUTION_PROTOCOL,
  status:complete?'FIXTURE_REAUDIT_PASS':'READ_ONLY_REAUDIT_BLOCKED',
  executionMode:rows.some(row=>row.mode==='read-only')?'read-only':'fixture',
  complete,
  remoteExecutionPerformed:false,
  providerCallsPerformed:false,
  activationAllowed:false,
  checks,
  steps:REAUDIT_EXECUTION_STEPS.map(step=>({step,observed:byStep.has(step),passed:byStep.get(step)?.passed===true}))
 };
}

export function requireReadOnlyStagingReauditExecution(input={}){
 const result=executeReadOnlyStagingReaudit(input);
 if(!result.complete)throw new Error('READ_ONLY_REAUDIT_INCOMPLETE');
 return freeze({...result});
}
