import {authenticateFirebaseRequest} from './firebase-auth.mjs';
import {AccountError,configured,context,hash,random,encrypt,decrypt,json,cookie,readCookie,event,now} from './account-common.mjs';
import {firebaseCall,credentials} from './firebase-accounts.mjs';
const ACCESS_MS=5*60000,IDLE_MS=7*86400000,ABSOLUTE_MS=30*86400000;
export async function verifyCredentials(env,creds){
 return authenticateFirebaseRequest(new Request('https://identity.uvenaro.invalid',{headers:{authorization:`Bearer ${creds.idToken}`}}),env,{details:true});
}
export async function profile(env,identity){
 const row=await env.DB.prepare('SELECT * FROM account_profiles WHERE owner_id=?').bind(identity.sub).first();
 if(!row)throw new AccountError('ACCOUNT_NOT_FOUND',401);
 const billing=await env.DB.prepare("SELECT plan_id FROM billing_accounts WHERE owner_id=? AND status='active' AND julianday(cycle_ends_at)>julianday('now')").bind(identity.sub).first();
 return {id:identity.sub,name:row.display_name,email:identity.email,emailVerified:identity.emailVerified,mfaEnabled:identity.mfaEnabled,
  plan:billing?.plan_id||'free',entitlements:[],locale:row.locale,timezone:row.timezone,status:row.status};
}
export async function revoke(env,session,reason){
 await env.DB.batch([
  env.DB.prepare('UPDATE account_sessions SET revoked_at=?,revoke_reason=?,credentials_cipher=NULL,refresh_lock=NULL WHERE id=? AND owner_id=? AND revoked_at IS NULL').bind(now(),reason,session.id,session.owner_id),
  event(env,session.owner_id,session.id,reason)
 ]);
}
export async function revokeAll(env,owner,reason,except=null){
 await env.DB.batch([
  env.DB.prepare('UPDATE account_sessions SET revoked_at=?,revoke_reason=?,credentials_cipher=NULL,refresh_lock=NULL WHERE owner_id=? AND revoked_at IS NULL AND (? IS NULL OR id!=?)').bind(now(),reason,owner,except,except),
  event(env,owner,except,reason)
 ]);
}
function label(request){
 const ua=request.headers.get('user-agent')||'';
 return /Android/i.test(ua)?'Android device':/iPhone/i.test(ua)?'iPhone':/iPad/i.test(ua)?'iPad':/Macintosh/i.test(ua)?'Mac browser':/Windows/i.test(ua)?'Windows browser':'Web browser';
}
export async function issueSession(request,env,creds,{displayName='',verifiedIdentity}={}){
 const ctx=await context(request,env),identity=verifiedIdentity||await verifyCredentials(env,creds),at=now(),id=crypto.randomUUID();
 if(!identity.email||identity.tokenExpiresAt<=at+1000)throw new AccountError('IDENTITY_UNAVAILABLE',503);
 const refreshToken=random(),accessToken='uv1.'+random(),expiresAt=Math.min(at+ACCESS_MS,identity.tokenExpiresAt);
 const encrypted=await encrypt(env,creds,`session:${id}:${identity.sub}`);
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO account_profiles (owner_id,display_name,email,created_at,updated_at) VALUES (?,?,?,?,?)
   ON CONFLICT(owner_id) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at`).bind(identity.sub,displayName||identity.name,identity.email.toLowerCase(),at,at),
  // A bounded number of active sessions prevents credential/session-table abuse.
  env.DB.prepare(`UPDATE account_sessions SET revoked_at=?,revoke_reason='session_limit',credentials_cipher=NULL WHERE id IN
   (SELECT id FROM account_sessions WHERE owner_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT -1 OFFSET 19)`).bind(at,identity.sub),
  env.DB.prepare(`INSERT INTO account_sessions (id,owner_id,origin,device_hash,device_name,credentials_cipher,created_at,last_active_at,authenticated_at,expires_at,idle_expires_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id,identity.sub,ctx.origin,ctx.deviceHash,label(request),encrypted,at,at,identity.authTime,at+ABSOLUTE_MS,at+IDLE_MS),
  env.DB.prepare('INSERT INTO account_refresh_tokens (token_hash,session_id,created_at) VALUES (?,?,?)').bind(await hash(refreshToken),id,at),
  env.DB.prepare('INSERT INTO account_access_tokens VALUES (?,?,?)').bind(await hash(accessToken),id,expiresAt),
  event(env,identity.sub,id,'sign_in')
 ]);
 return json({accessToken,expiresAt,user:await profile(env,identity)},200,{'set-cookie':cookie(refreshToken)});
}
export async function authenticateAccountRequest(request,env){
 configured(env);
 const value=request.headers.get('authorization')?.match(/^Bearer (uv1\.[A-Za-z0-9_-]{43})$/)?.[1];
 if(!value)throw new AccountError('UNAUTHORIZED',401);
 const at=now();
 const row=await env.DB.prepare(`SELECT s.* FROM account_access_tokens t JOIN account_sessions s ON s.id=t.session_id
  WHERE t.token_hash=? AND t.expires_at>? AND s.revoked_at IS NULL AND s.expires_at>? AND s.idle_expires_at>?`).bind(await hash(value),at,at,at).first();
 if(!row)throw new AccountError('SESSION_EXPIRED',401);
 const creds=await decrypt(env,row.credentials_cipher,`session:${row.id}:${row.owner_id}`);
 let identity;try{identity=await verifyCredentials(env,creds);}catch(error){if(error.status===401)await revoke(env,row,'identity_revoked');throw error;}
 if(identity.sub!==row.owner_id){await revoke(env,row,'identity_mismatch');throw new AccountError('UNAUTHORIZED',401);}
 const active=await env.DB.prepare('SELECT id FROM account_sessions WHERE id=? AND revoked_at IS NULL AND expires_at>? AND idle_expires_at>?').bind(row.id,now(),now()).first();
 if(!active)throw new AccountError('SESSION_EXPIRED',401);
 return {...identity,session:row,credentials:creds};
}
export async function refreshSession(request,env){
 const ctx=await context(request,env),token=readCookie(request);if(!token)throw new AccountError('SESSION_EXPIRED',401);
 const tokenHash=await hash(token),at=now();
 const row=await env.DB.prepare(`SELECT s.*,t.consumed_at FROM account_refresh_tokens t JOIN account_sessions s ON s.id=t.session_id WHERE t.token_hash=?`).bind(tokenHash).first();
 if(!row||row.revoked_at!==null||row.expires_at<=at||row.idle_expires_at<=at)throw new AccountError('SESSION_EXPIRED',401);
 if(row.origin!==ctx.origin||row.device_hash!==ctx.deviceHash)throw new AccountError('SESSION_CONTEXT_MISMATCH',401);
 if(row.refresh_lock&&at-row.refresh_started_at>120000){await revoke(env,row,'refresh_interrupted');throw new AccountError('SESSION_EXPIRED',401);}
 if(row.consumed_at!==null){
  if(at-row.consumed_at<10000)throw new AccountError('SESSION_REFRESH_BUSY',409);
  await revoke(env,row,'refresh_reuse');throw new AccountError('SESSION_EXPIRED',401);
 }
 const lock=random();
 const claimed=await env.DB.prepare(`UPDATE account_sessions SET refresh_lock=?,refresh_started_at=? WHERE id=? AND revoked_at IS NULL AND refresh_lock IS NULL
  AND EXISTS(SELECT 1 FROM account_refresh_tokens WHERE token_hash=? AND consumed_at IS NULL) RETURNING id`).bind(lock,at,row.id,tokenHash).first();
 if(!claimed)throw new AccountError('SESSION_REFRESH_BUSY',409);
 try{
  await env.DB.prepare('UPDATE account_refresh_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL').bind(at,tokenHash).run();
  const previous=await decrypt(env,row.credentials_cipher,`session:${row.id}:${row.owner_id}`);
  const creds=credentials(await firebaseCall(env,'',{grant_type:'refresh_token',refresh_token:previous.refreshToken},{refresh:true}),{refresh:true});
  const identity=await verifyCredentials(env,creds);if(identity.sub!==row.owner_id)throw new AccountError('UNAUTHORIZED',401);
  const next=random(),access='uv1.'+random(),expiresAt=Math.min(now()+ACCESS_MS,identity.tokenExpiresAt);
  const encrypted=await encrypt(env,creds,`session:${row.id}:${row.owner_id}`);
  await env.DB.batch([
   env.DB.prepare(`UPDATE account_sessions SET credentials_cipher=?,refresh_lock=NULL,refresh_started_at=NULL,last_active_at=?,idle_expires_at=? WHERE id=? AND revoked_at IS NULL AND refresh_lock=?`).bind(encrypted,now(),Math.min(row.expires_at,now()+IDLE_MS),row.id,lock),
   env.DB.prepare(`INSERT INTO account_refresh_tokens (token_hash,session_id,created_at) SELECT ?,id,? FROM account_sessions WHERE id=? AND revoked_at IS NULL AND refresh_lock IS NULL`).bind(await hash(next),now(),row.id),
   env.DB.prepare(`INSERT INTO account_access_tokens SELECT ?,id,? FROM account_sessions WHERE id=? AND revoked_at IS NULL AND refresh_lock IS NULL`).bind(await hash(access),expiresAt,row.id)
  ]);
  if(!await env.DB.prepare('SELECT token_hash FROM account_access_tokens WHERE token_hash=?').bind(await hash(access)).first())throw new AccountError('SESSION_EXPIRED',401);
  return json({accessToken:access,expiresAt,user:await profile(env,identity)},200,{'set-cookie':cookie(next)});
 }catch(error){await revoke(env,row,'refresh_failed');throw error instanceof AccountError&&!error.providerCode?error:new AccountError('SESSION_EXPIRED',401);}
}
export function requireRecent(user){if(now()-user.session.authenticated_at>5*60000)throw new AccountError('RECENT_AUTH_REQUIRED',403);}
export async function cleanupAccounts(env){
 if(!env.DB||env.ACCOUNT_AUTH_ENABLED!=='true')return;
 const at=now();await env.DB.batch([
  env.DB.prepare('DELETE FROM account_access_tokens WHERE token_hash IN (SELECT token_hash FROM account_access_tokens WHERE expires_at<? LIMIT 500)').bind(at),
  env.DB.prepare('DELETE FROM account_rate_limits WHERE bucket IN (SELECT bucket FROM account_rate_limits WHERE expires_at<? LIMIT 500)').bind(at),
  env.DB.prepare('DELETE FROM account_challenges WHERE id IN (SELECT id FROM account_challenges WHERE expires_at<? LIMIT 100)').bind(at),
  env.DB.prepare("UPDATE account_sessions SET revoked_at=?,revoke_reason='expired',credentials_cipher=NULL WHERE id IN (SELECT id FROM account_sessions WHERE revoked_at IS NULL AND (expires_at<? OR idle_expires_at<?) LIMIT 100)").bind(at,at,at)
 ]);
}
