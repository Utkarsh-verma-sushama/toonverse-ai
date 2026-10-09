const freeze=Object.freeze;

export const PROVIDER_FUNDING_POLICY_PROTOCOL='uvenaro-provider-funding-policy-v1';

export const DEFAULT_PROVIDER_FUNDING_POLICY=freeze({
 billingConfigured:false,
 ownerSpendCapMicrousd:0,
 autoTopUp:false,
 paidRequestsAllowed:false,
 zeroOwnerSpendBoundary:true,
 fundingSource:'provider-free-tier'
});

export function validateProviderFundingPolicy(policy=DEFAULT_PROVIDER_FUNDING_POLICY){
 const errors=[];
 const check=(ok,code)=>{if(!ok)errors.push(code);};
 check(policy&&typeof policy==='object','FUNDING_POLICY_MISSING');
 if(!policy||typeof policy!=='object')return {ok:false,errors,policy};
 check(policy.billingConfigured===false,'BILLING_MUST_BE_DISABLED');
 check(policy.ownerSpendCapMicrousd===0,'OWNER_SPEND_CAP_MUST_BE_ZERO');
 check(policy.autoTopUp===false,'AUTO_TOP_UP_MUST_BE_DISABLED');
 check(policy.paidRequestsAllowed===false,'PAID_REQUESTS_MUST_BE_DISABLED');
 check(policy.zeroOwnerSpendBoundary===true,'ZERO_OWNER_SPEND_BOUNDARY_REQUIRED');
 check(policy.fundingSource==='provider-free-tier','UNAPPROVED_FUNDING_SOURCE');
 return {ok:errors.length===0,errors,policy};
}

export function enforceProviderFundingPolicy(request={}){
 const violations=[];
 if(request.billingConfigured===true)violations.push('BILLING_ENABLE_FORBIDDEN');
 if(request.autoTopUp===true)violations.push('AUTO_TOP_UP_FORBIDDEN');
 if(request.paidRequestsAllowed===true)violations.push('PAID_REQUESTS_FORBIDDEN');
 if(request.ownerSpendMicrousd!==undefined&&request.ownerSpendMicrousd!==0)violations.push('OWNER_SPEND_FORBIDDEN');
 if(request.ownerSpendCapMicrousd!==undefined&&request.ownerSpendCapMicrousd!==0)violations.push('OWNER_SPEND_CAP_MUST_BE_ZERO');
 if(request.fundingSource!==undefined&&request.fundingSource!=='provider-free-tier')violations.push('UNAPPROVED_FUNDING_SOURCE');
 if(violations.length)throw new Error(violations[0]);
 return {...DEFAULT_PROVIDER_FUNDING_POLICY};
}
