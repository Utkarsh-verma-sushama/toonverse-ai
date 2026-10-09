const freeze=Object.freeze;

export const PROVIDER_CONTRACT_PROTOCOL='uvenaro-provider-contract-v1';

const auditFlags=freeze([
 'GEMINI_MODEL_PROFILE_AUDITED',
 'GEMINI_PREFLIGHT_AUDITED',
 'GEMINI_COUNT_TOKENS_NONBILLABLE_AUDITED',
 'GEMINI_PRIVACY_PRICING_AUDITED'
]);

// Provider profiles are additive. The gateway speaks the stable bounded-metered-v1
// protocol; a new provider/model profile must not change billing or receipt semantics.
const contracts={
 'google-gemini':freeze({
  provider:'google-gemini',
  protocol:'bounded-metered-v1',
  modelPattern:/^gemini-3(?:\.\d+)?-(?:flash|flash-lite)$/,
  methods:freeze({countTokens:'countTokens',generateContent:'generateContent'}),
  limits:freeze({maxInputTokens:12000,maxOutputTokens:12000,maxTotalTokens:20000}),
  accounting:freeze({
   prompt:'promptTokenCount',
   candidate:'candidatesTokenCount',
   thoughts:'thoughtsTokenCount',
   total:'totalTokenCount',
   cached:'cachedContentTokenCount',
   tools:'toolUsePromptTokenCount'
  }),
  controls:freeze({candidateCount:1,thinkingLevel:'low',streaming:false,tools:false}),
  requiredAuditFlags:auditFlags
 })
};

export const PROVIDER_CONTRACTS=freeze(contracts);

export function getProviderContract(provider='google-gemini'){
 return PROVIDER_CONTRACTS[provider]??null;
}

export function validateProviderContract(env,{provider=env?.GEMINI_PROVIDER||'google-gemini',allowBlankModel=true}={}){
 const contract=getProviderContract(provider),errors=[];
 const check=(ok,code)=>{if(!ok)errors.push(code);};
 check(Boolean(contract),'UNKNOWN_PROVIDER_CONTRACT');
 if(!contract)return {ok:false,errors,contract:null,provider};
 const model=typeof env?.GEMINI_MODEL==='string'?env.GEMINI_MODEL:'';
 check(allowBlankModel&&model===''||contract.modelPattern.test(model),'MODEL_PROFILE_UNSUPPORTED');
 check(contract.protocol==='bounded-metered-v1','PROVIDER_PROTOCOL_UNSUPPORTED');
 check(Number.isSafeInteger(contract.limits.maxInputTokens)&&contract.limits.maxInputTokens>0,'INPUT_LIMIT_INVALID');
 check(Number.isSafeInteger(contract.limits.maxOutputTokens)&&contract.limits.maxOutputTokens>0,'OUTPUT_LIMIT_INVALID');
 check(Number.isSafeInteger(contract.limits.maxTotalTokens)&&contract.limits.maxTotalTokens>=contract.limits.maxOutputTokens,'TOTAL_LIMIT_INVALID');
 check(contract.controls.candidateCount===1&&contract.controls.streaming===false&&contract.controls.tools===false,'UNSAFE_PROVIDER_CONTROLS');
 check(Array.isArray(contract.requiredAuditFlags)&&contract.requiredAuditFlags.length===4,'AUDIT_PROFILE_INCOMPLETE');
 return {ok:errors.length===0,errors,contract,provider};
}

export function requireProviderContract(env,options={}){
 const result=validateProviderContract(env,{...options,allowBlankModel:false});
 if(!result.ok)throw new Error('ADAPTER_NOT_CONFIGURED');
 return result.contract;
}
