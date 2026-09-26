import test from "node:test";
import assert from "node:assert/strict";
import { createAppCheckVerifier, AttestationError } from "../backend/app-check.mjs";

const env={APP_CHECK_ENFORCEMENT_ENABLED:"true",FIREBASE_PROJECT_ID:"toonverse-ai",APP_CHECK_ALLOWED_APP_IDS:"1:123:web:allowed"};
const request=token=>new Request("https://api.uvenaro.invalid/v1/chat/responses",{headers:token?{"x-firebase-appcheck":token}:{}});
async function rejected(verifier,req,code="APP_ATTESTATION_REQUIRED"){
 await assert.rejects(()=>verifier(req,env),e=>e instanceof AttestationError&&e.code===code);
}
test("App Check is fail-closed when token is absent",async()=>{await rejected(createAppCheckVerifier(),request());});
test("App Check rejects malformed and oversized tokens before network work",async()=>{
 const verifier=createAppCheckVerifier({fetch:async()=>{throw new Error("network must not be reached");}});
 await rejected(verifier,request("not-a-jwt"));
 await rejected(verifier,request("x".repeat(16385)));
});
test("App Check can be explicitly disabled for staged rollout",async()=>{
 const verifier=createAppCheckVerifier({fetch:async()=>{throw new Error("network must not be reached");}});
 assert.deepEqual(await verifier(request(),{...env,APP_CHECK_ENFORCEMENT_ENABLED:"false"}),{enforced:false});
});
test("App Check rejects a syntactically valid token with an untrusted key",async()=>{
 const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
 const now=Math.floor(Date.now()/1000);
 const token=[b64({alg:"RS256",kid:"unknown"}),b64({iss:"https://firebaseappcheck.googleapis.com/toonverse-ai",aud:["projects/toonverse-ai"],sub:"1:123:web:allowed",iat:now-1,exp:now+300}),"AA"].join(".");
 const verifier=createAppCheckVerifier({fetch:async()=>new Response(JSON.stringify({keys:[{kty:"RSA",alg:"RS256",use:"sig",kid:"other",n:"sXch",e:"AQAB"}]}),{status:200,headers:{"cache-control":"max-age=300"}})});
 await assert.rejects(()=>verifier(request(token),env),e=>e instanceof AttestationError);
});

async function signedFixture(overrides={}){
 const pair=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
 const jwk=await crypto.subtle.exportKey("jwk",pair.publicKey);Object.assign(jwk,{alg:"RS256",use:"sig",kid:"test-key"});
 const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url"),sec=1700000000;
 const claims={iss:"https://firebaseappcheck.googleapis.com/toonverse-ai",aud:["projects/toonverse-ai"],sub:"1:123:web:allowed",iat:sec-1,exp:sec+300,...overrides};
 const head=b64({alg:"RS256",kid:"test-key"}),body=b64(claims),data=`${head}.${body}`;
 const sig=Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",pair.privateKey,new TextEncoder().encode(data))).toString("base64url");
 const fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{"cache-control":"max-age=300"}});
 return {token:`${data}.${sig}`,fetch,now:()=>sec*1000};
}
test("App Check accepts a valid cryptographically signed allowed-app token",async()=>{
 const x=await signedFixture(),verifier=createAppCheckVerifier({fetch:x.fetch,now:x.now});
 const out=await verifier(request(x.token),env);assert.equal(out.enforced,true);assert.equal(out.appId,"1:123:web:allowed");
});
for(const [name,claims] of [
 ["wrong issuer",{iss:"https://attacker.invalid"}],
 ["wrong audience",{aud:["projects/other-project"]}],
 ["expired token",{exp:1699999999}],
 ["future-issued token",{iat:1700000001}],
 ["unauthorized app id",{sub:"1:123:web:not-allowed"}]
]){
 test(`App Check rejects ${name}`,async()=>{const x=await signedFixture(claims);await rejected(createAppCheckVerifier({fetch:x.fetch,now:x.now}),request(x.token));});
}
test("App Check fails closed when signing keys are unavailable",async()=>{
 const x=await signedFixture(),verifier=createAppCheckVerifier({now:x.now,fetch:async()=>new Response("unavailable",{status:503})});
 await rejected(verifier,request(x.token),"APP_ATTESTATION_UNAVAILABLE");
});
