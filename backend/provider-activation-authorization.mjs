const freeze=Object.freeze;

export const PROVIDER_ACTIVATION_AUTHORIZATION_PROTOCOL='uvenaro-provider-activation-authorization-v1';
export const PROVIDER_ACTIVATION_AUTHORIZATION_SCOPE='provider-generation';
export const PROVIDER_ACTIVATION_AUTHORIZATION_MAX_AGE_MS=60*60*1000;

function dated(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}

export function evaluateProviderActivationAuthorization(record={},asOf=new Date().toISOString()){
 const checks={
  activationAuthorized:record.activationAuthorized===true,
  approvedBy:typeof record.approvedBy==='string'&&record.approvedBy.trim().length>=3,
  approvedAt:dated(record.approvedAt),
  scope:record.scope===PROVIDER_ACTIVATION_AUTHORIZATION_SCOPE,
  reason:typeof record.reason==='string'&&record.reason.trim().length>=8,
  authorizationId:typeof record.authorizationId==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(record.authorizationId),
  integrityVerified:record.integrityVerified===true&&typeof record.authorizationDigest==='string'&&/^[a-f0-9]{64}$/.test(record.authorizationDigest),
  zeroOwnerSpend:record.ownerSpendCapMicrousd===0&&record.billingChangeAuthorized===false,
  backgroundAiDisabled:record.backgroundAiEnabled===false
 };
 if(checks.approvedAt){
  const age=Date.parse(asOf)-Date.parse(record.approvedAt);
  checks.notFuture=age>=0;
  checks.fresh=age<=PROVIDER_ACTIVATION_AUTHORIZATION_MAX_AGE_MS;
 }else{
  checks.notFuture=false;checks.fresh=false;
 }
 return {protocol:PROVIDER_ACTIVATION_AUTHORIZATION_PROTOCOL,ok:Object.values(checks).every(Boolean),checks};
}

export function requireProviderActivationAuthorization(record={},asOf=new Date().toISOString()){
 const result=evaluateProviderActivationAuthorization(record,asOf);
 if(!result.ok)throw new Error('ACTIVATION_AUTHORIZATION_REQUIRED');
 return freeze({...result});
}
