const enc=new TextEncoder();
export class AccountError extends Error {
  constructor(code,status=400,extra={}){super(code);this.code=code;this.status=status;this.extra=extra;}
}
export const now=()=>Date.now();
export const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const unb64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
export const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export const hash=async value=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))));
function secret(env){
 try{const bytes=unb64(String(env.ACCOUNT_SESSION_KEY||''));if(bytes.length===32)return bytes;}catch{}
 throw new AccountError('ACCOUNT_NOT_CONFIGURED',503);
}
export function configured(env){
 if(env.ACCOUNT_AUTH_ENABLED!=='true')throw new AccountError('ACCOUNT_SERVICE_DISABLED',503);
 if(!env.DB||!env.FIREBASE_PROJECT_ID||!env.FIREBASE_WEB_API_KEY)throw new AccountError('ACCOUNT_NOT_CONFIGURED',503);
 secret(env);
}
export async function keyedHash(env,value){
 const key=await crypto.subtle.importKey('raw',secret(env),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode('uvenaro/account/hash/v1:'+value))));
}
export async function encrypt(env,value,context){
 const key=await crypto.subtle.importKey('raw',secret(env),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const body=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(context)},key,enc.encode(JSON.stringify(value)));
 return b64(iv)+'.'+b64(new Uint8Array(body));
}
export async function decrypt(env,value,context){
 try{
  const [iv,body]=value.split('.');const key=await crypto.subtle.importKey('raw',secret(env),'AES-GCM',false,['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:enc.encode(context)},key,unb64(body))));
 }catch{throw new AccountError('SESSION_UNAVAILABLE',503);}
}
export function securityContext(request,env){
 const url=new URL(request.url),origin=request.headers.get('origin')||
  (request.method==='GET'&&request.headers.get('sec-fetch-site')==='same-origin'?url.origin:null);
 const allowed=String(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(x=>x&&x!=='null'&&x!=='*');
 if(url.protocol!=='https:'||!origin||!allowed.includes(origin))throw new AccountError('ORIGIN_NOT_ALLOWED',403);
 if(request.headers.get('x-uvenaro-csrf')!=='1')throw new AccountError('CSRF_CHECK_FAILED',403);
 const device=request.headers.get('x-uvenaro-device')||'';
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(device))throw new AccountError('DEVICE_ID_REQUIRED',400);
 return {origin,device};
}
export async function context(request,env){
 const value=securityContext(request,env);return {...value,deviceHash:await keyedHash(env,'device:'+value.device)};
}
export function email(value){
 if(typeof value!=='string')throw new AccountError('INVALID_EMAIL');
 const out=value.trim().toLowerCase();
 if(out.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out))throw new AccountError('INVALID_EMAIL');
 return out;
}
export function password(value,{newPassword=false}={}){
 if(typeof value!=='string'||value.length<(newPassword?12:1)||value.length>128)throw new AccountError(newPassword?'PASSWORD_POLICY':'INVALID_CREDENTIALS');
 return value; // No normalization, trimming, or logging of passwords.
}
export function name(value){if(typeof value!=='string'||!value.trim()||value.length>80||/[\x00-\x1f\x7f]/.test(value))throw new AccountError('INVALID_NAME');return value.trim();}
export const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'cache-control':'no-store','pragma':'no-cache',...headers}});
export const cookie=value=>`__Host-uvenaro-session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value?2592000:0}`;
export function readCookie(request){
 const matches=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('__Host-uvenaro-session='));
 if(matches.length!==1)return '';
 const value=matches[0].slice('__Host-uvenaro-session='.length);return /^[A-Za-z0-9_-]{43}$/.test(value)?value:'';
}
export function event(env,owner,session,type){return env.DB.prepare('INSERT INTO account_security_events (id,owner_id,session_id,event_type,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),owner,session,type,now());}
export async function rateLimit(env,request,scope,identifier='',maximum=10,windowMs=900000){
 const at=now(),period=Math.floor(at/windowMs),network=request.headers.get('cf-connecting-ip')||'unknown-network';
 // CF-Connecting-IP is set by Workers ingress. Never trust X-Forwarded-For.
 const dimensions=[['network',network,Math.max(30,maximum*5)],['device',request.headers.get('x-uvenaro-device')||'missing',maximum*2]];
 if(identifier)dimensions.push(['account',identifier,maximum]);
 for(const [kind,value,limit] of dimensions){
  const bucket=await keyedHash(env,`${scope}:${kind}:${value}:${period}`);
  const row=await env.DB.prepare(`INSERT INTO account_rate_limits (bucket,count,expires_at) VALUES (?,1,?)
   ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`).bind(bucket,(period+1)*windowMs,limit).first();
  if(!row)throw new AccountError('TOO_MANY_ATTEMPTS',429,{retryAfter:Math.ceil(((period+1)*windowMs-at)/1000)});
 }
}

export function accountAllowed(env,address){
 if(env.ACCOUNT_ALLOWED_EMAILS===undefined)return true;
 return String(env.ACCOUNT_ALLOWED_EMAILS).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(String(address).toLowerCase());
}
export function requireAllowedAccount(env,address){if(!accountAllowed(env,address))throw new AccountError('ACCOUNT_NOT_IN_PILOT',403);}
