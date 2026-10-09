const freeze=Object.freeze;

export const GEMINI_PRIVACY_POLICY_PROTOCOL='uvenaro-gemini-privacy-policy-v1';

export const GEMINI_PRIVACY_POLICY=freeze({
 store:false,
 background:false,
 fileApi:false,
 contextCaching:false,
 grounding:false,
 retentionDays:0,
 promptsPersisted:false,
 answersPersisted:false
});

export function validateGeminiPrivacyPolicy(policy=GEMINI_PRIVACY_POLICY){
 const errors=[];
 const check=(ok,code)=>{if(!ok)errors.push(code);};
 check(policy&&policy.store===false,'PRIVACY_STORE_MUST_BE_FALSE');
 check(policy&&policy.background===false,'PRIVACY_BACKGROUND_MUST_BE_FALSE');
 check(policy&&policy.fileApi===false,'PRIVACY_FILE_API_MUST_BE_FALSE');
 check(policy&&policy.contextCaching===false,'PRIVACY_CONTEXT_CACHE_MUST_BE_FALSE');
 check(policy&&policy.grounding===false,'PRIVACY_GROUNDING_MUST_BE_FALSE');
 check(policy&&policy.retentionDays===0,'PRIVACY_RETENTION_MUST_BE_ZERO');
 check(policy&&policy.promptsPersisted===false,'PRIVACY_PROMPTS_MUST_NOT_PERSIST');
 check(policy&&policy.answersPersisted===false,'PRIVACY_ANSWERS_MUST_NOT_PERSIST');
 return {ok:errors.length===0,errors};
}

export function enforceGeminiPrivacyPolicy(request={}){
 const errors=[];
 const check=(ok,code)=>{if(!ok)errors.push(code);};
 check(request.store!==true,'REQUEST_STATE_STORAGE_FORBIDDEN');
 check(request.background!==true,'REQUEST_BACKGROUND_FORBIDDEN');
 check(request.fileApi!==true&&request.file!==true,'REQUEST_FILE_PERSISTENCE_FORBIDDEN');
 check(request.contextCaching!==true&&request.cachedContent===undefined,'REQUEST_CONTEXT_CACHE_FORBIDDEN');
 check(request.grounding!==true&&request.googleSearch!==true,'REQUEST_GROUNDING_FORBIDDEN');
 check(request.retentionDays===undefined||request.retentionDays===0,'REQUEST_RETENTION_FORBIDDEN');
 return {
  protocol:GEMINI_PRIVACY_POLICY_PROTOCOL,
  ok:errors.length===0,
  errors,
  normalized:{store:false,background:false,fileApi:false,contextCaching:false,grounding:false,retentionDays:0}
 };
}
