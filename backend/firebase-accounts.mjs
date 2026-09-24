import {AccountError} from './account-common.mjs';
export class FirebaseAccountError extends AccountError {
 constructor(code){super('IDENTITY_OPERATION_FAILED',400);this.providerCode=code;}
}
export async function firebaseCall(env,method,body,{refresh=false,v2=false}={}){
 const origin=refresh?'https://securetoken.googleapis.com/v1/token':`https://identitytoolkit.googleapis.com/${v2?'v2':'v1'}/${method}`;
 let response,payload;
 try{
  response=await fetch(`${origin}?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
   headers:{'content-type':refresh?'application/x-www-form-urlencoded':'application/json'},body:refresh?new URLSearchParams(body).toString():JSON.stringify(body)});
  const reader=response.body?.getReader();if(!reader)throw new Error();const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072){await reader.cancel();throw new Error();}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}payload=JSON.parse(new TextDecoder().decode(bytes));
 }catch{throw new AccountError('IDENTITY_UNAVAILABLE',503);}
 if(!response.ok){
  const code=String(payload?.error?.message||'UNKNOWN').split(' : ')[0];
  if(response.status>=500||['TOO_MANY_ATTEMPTS_TRY_LATER','QUOTA_EXCEEDED','RESET_PASSWORD_EXCEED_LIMIT'].includes(code))throw new AccountError('IDENTITY_UNAVAILABLE',503);
  throw new FirebaseAccountError(code);
 }
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new AccountError('IDENTITY_UNAVAILABLE',503);
 return payload;
}
export function credentials(payload,{refresh=false}={}){
 const idToken=refresh?payload.id_token:payload.idToken,refreshToken=refresh?payload.refresh_token:payload.refreshToken;
 if(typeof idToken!=='string'||idToken.length>16384||typeof refreshToken!=='string'||!refreshToken||refreshToken.length>16384)throw new AccountError('IDENTITY_UNAVAILABLE',503);
 return {idToken,refreshToken};
}
