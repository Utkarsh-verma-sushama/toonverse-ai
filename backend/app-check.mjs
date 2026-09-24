// Firebase App Check verification for protected production API requests.
// Fail-closed in production when APP_CHECK_ENFORCEMENT_ENABLED=true.
// This verifies issuer/audience/signature and bounds key refreshes. High-cost
// endpoints should additionally use replay-resistant limited-use tokens.
const KEYS_URL="https://firebaseappcheck.googleapis.com/v1/jwks";
const enc=new TextEncoder();
export class AttestationError extends Error{constructor(code="APP_ATTESTATION_REQUIRED",status=401){super(code);this.code=code;this.status=status;}}
const bad=()=>new AttestationError();
const unavailable=()=>new AttestationError("APP_ATTESTATION_UNAVAILABLE",503);
function decode(v){if(!/^[A-Za-z0-9_-]+$/.test(v))throw bad();const b=v.replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(b+"=".repeat((4-b.length%4)%4)),c=>c.charCodeAt(0));}
export function createAppCheckVerifier({fetch:fetcher=(...a)=>fetch(...a),now=Date.now}={}){
 let keys=new Map(),expires=0,refreshAfter=0,pending;
 async function refresh(){
  if(pending)return pending;if(now()<refreshAfter)throw unavailable();refreshAfter=now()+30000;
  pending=(async()=>{let r,p;try{r=await fetcher(KEYS_URL,{headers:{accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(5000)});p=await r.json();}catch{throw unavailable();}
   if(!r.ok||!Array.isArray(p?.keys)||!p.keys.length||p.keys.length>20)throw unavailable();
   const next=new Map();for(const jwk of p.keys){if(jwk.kty!=="RSA"||jwk.alg!=="RS256"||jwk.use!=="sig"||typeof jwk.kid!=="string"||jwk.kid.length>256)continue;try{next.set(jwk.kid,await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]));}catch{throw unavailable();}}
   if(!next.size)throw unavailable();const ttl=Number(r.headers.get("cache-control")?.match(/(?:^|[,\s])max-age=(\d+)/)?.[1]??300);keys=next;expires=now()+Math.min(ttl,21600)*1000;
  })();try{await pending;}finally{pending=undefined;}
 }
 return async function verify(request,env){
  if(env.APP_CHECK_ENFORCEMENT_ENABLED!=="true")return Object.freeze({enforced:false});
  const project=String(env.FIREBASE_PROJECT_ID||"").trim(),token=request.headers.get("x-firebase-appcheck")||"";
  if(!project||!token||token.length>16384)throw bad();
  const parts=token.split(".");let h,c,s;try{if(parts.length!==3)throw bad();h=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decode(parts[0])));c=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decode(parts[1])));s=decode(parts[2]);}catch{throw bad();}
  const sec=Math.floor(now()/1000),aud=Array.isArray(c.aud)?c.aud:[c.aud],issuer=`https://firebaseappcheck.googleapis.com/${project}`;
  if(!h||h.alg!=="RS256"||typeof h.kid!=="string"||!h.kid||h.crit!==undefined||!c||c.iss!==issuer||!aud.includes(`projects/${project}`)||!Number.isSafeInteger(c.exp)||!Number.isSafeInteger(c.iat)||c.exp<=sec||c.iat>sec||c.exp<=c.iat||typeof c.sub!=="string"||!c.sub)throw bad();
  if(now()>=expires)await refresh();else if(!keys.has(h.kid)&&now()>=refreshAfter)await refresh();const key=keys.get(h.kid);if(!key)throw bad();
  if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,s,enc.encode(`${parts[0]}.${parts[1]}`)))throw bad();
  const allowed=String(env.APP_CHECK_ALLOWED_APP_IDS||"").split(",").map(x=>x.trim()).filter(Boolean);
  if(!allowed.length||!allowed.includes(c.sub))throw bad();
  return Object.freeze({enforced:true,appId:c.sub,issuedAt:c.iat*1000,expiresAt:c.exp*1000});
 };
}
export const verifyAppCheckRequest=createAppCheckVerifier();
