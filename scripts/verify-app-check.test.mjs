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
