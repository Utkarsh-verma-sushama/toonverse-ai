const enc=new TextEncoder();
export class ReplayError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
async function hash(value){const b=await crypto.subtle.digest("SHA-256",enc.encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
export async function consumeReplayNonce(env,user,request,purpose){
 if(env.REPLAY_PROTECTION_ENABLED!=="true")return {enforced:false};
 if(!env.DB)throw new ReplayError("REPLAY_PROTECTION_UNAVAILABLE",503);
 const nonce=request.headers.get("x-uvenaro-nonce")||"";
 if(!/^[A-Za-z0-9_-]{32,128}$/.test(nonce))throw new ReplayError("VALID_REQUEST_NONCE_REQUIRED",400);
 if(!user?.sub||!["chat","agent","media"].includes(purpose))throw new ReplayError("INVALID_REQUEST_NONCE",400);
 const digest=await hash(nonce),now=new Date().toISOString(),expires=new Date(Date.now()+5*60*1000).toISOString();
 try{
  await env.DB.prepare("INSERT INTO request_nonces(owner_id,nonce_hash,purpose,created_at,expires_at) VALUES(?,?,?,?,?)")
    .bind(user.sub,digest,purpose,now,expires).run();
  return {enforced:true};
 }catch(error){
  const m=String(error?.message||"");
  if(/UNIQUE constraint|PRIMARY KEY/i.test(m))throw new ReplayError("REQUEST_REPLAY_DETECTED");
  if(/no such table/i.test(m))throw new ReplayError("REPLAY_PROTECTION_NOT_READY",503);
  if(/INVALID_REQUEST_NONCE/i.test(m))throw new ReplayError("INVALID_REQUEST_NONCE",400);
  throw new ReplayError("REPLAY_PROTECTION_UNAVAILABLE",503);
 }
}

export async function cleanupReplayNonces(env){
 if(!env.DB)return;
 try{await env.DB.prepare("DELETE FROM request_nonces WHERE julianday(expires_at)<=julianday('now')").run();}
 catch(error){if(!/no such table/i.test(String(error?.message||"")))throw error;}
}
