import {AccountError,context,random,encrypt,decrypt,now,event,rateLimit} from './account-common.mjs';
import {firebaseCall,credentials} from './firebase-accounts.mjs';
import {issueSession,verifyCredentials,requireRecent,revokeAll} from './account-sessions.mjs';
export async function saveChallenge(request,env,kind,payload,user){
 const ctx=await context(request,env),id=random(),at=now();
 // Supersede older live challenges for the same authenticated account and operation.
 if(user?.sub)await env.DB.prepare("UPDATE account_challenges SET consumed_at=? WHERE owner_id=? AND kind=? AND consumed_at IS NULL AND expires_at>?").bind(at,user.sub,kind,at).run();
 await env.DB.prepare(`INSERT INTO account_challenges (id,kind,owner_id,session_id,device_hash,origin,payload_cipher,expires_at)
  VALUES (?,?,?,?,?,?,?,?)`).bind(id,kind,user?.sub||null,user?.session.id||null,ctx.deviceHash,ctx.origin,await encrypt(env,payload,'challenge:'+id),at+300000).run();
 return id;
}
export async function challenge(request,env,id,kind,user){
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(id))throw new AccountError('INVALID_CHALLENGE',401);
 const ctx=await context(request,env);
 const row=await env.DB.prepare(`UPDATE account_challenges SET attempts=attempts+1 WHERE id=? AND kind=? AND consumed_at IS NULL
  AND expires_at>? AND attempts<5 AND device_hash=? AND origin=? AND (session_id IS NULL OR session_id=?) RETURNING *`)
  .bind(id,kind,now(),ctx.deviceHash,ctx.origin,user?.session.id||null).first();
 if(!row)throw new AccountError('INVALID_CHALLENGE',401);
 return {row,payload:await decrypt(env,row.payload_cipher,'challenge:'+id)};
}
async function consume(env,id){
 const result=await env.DB.prepare('UPDATE account_challenges SET consumed_at=?,payload_cipher=? WHERE id=? AND consumed_at IS NULL RETURNING id').bind(now(),'consumed',id).first();
 if(!result)throw new AccountError('INVALID_CHALLENGE',401);
}
export async function mfaRequired(request,env,payload,user){
 const methods=(payload.mfaInfo||[]).filter(m=>m.totpInfo&&typeof m.mfaEnrollmentId==='string').map(m=>({id:m.mfaEnrollmentId,name:m.displayName||'Authenticator'}));
 if(!methods.length)throw new AccountError('MFA_METHOD_UNAVAILABLE',503);
 const challengeId=await saveChallenge(request,env,user?'reauth_mfa':'mfa_signin',{pending:payload.mfaPendingCredential,methods},user);
 throw new AccountError('MFA_REQUIRED',401,{challengeId,methods});
}
export async function finishMfa(request,env,input,user){
 if(!/^\d{6,8}$/.test(input.code||''))throw new AccountError('INVALID_VERIFICATION_CODE',401);
 await rateLimit(env,request,'mfa',input.challengeId,10);
 const {row,payload}=await challenge(request,env,input.challengeId,user?'reauth_mfa':'mfa_signin',user);
 if(!payload.methods.some(m=>m.id===input.methodId))throw new AccountError('INVALID_CHALLENGE',401);
 const creds=credentials(await firebaseCall(env,'accounts/mfaSignIn:finalize',{mfaPendingCredential:payload.pending,mfaEnrollmentId:input.methodId,totpVerificationInfo:{verificationCode:input.code}},{v2:true}));
 const identity=await verifyCredentials(env,creds);if(user&&identity.sub!==user.sub)throw new AccountError('UNAUTHORIZED',401);
 await consume(env,row.id);
 if(user){await updateReauth(env,user,creds,identity);return {ok:true};}
 return issueSession(request,env,creds,{verifiedIdentity:identity});
}
export async function updateReauth(env,user,creds,identity){
 if(identity.sub!==user.sub||now()-identity.authTime>60000)throw new AccountError('UNAUTHORIZED',401);
 const cipher=await encrypt(env,creds,`session:${user.session.id}:${user.sub}`);
 const out=await env.DB.prepare('UPDATE account_sessions SET authenticated_at=?,credentials_cipher=? WHERE id=? AND revoked_at IS NULL RETURNING id').bind(identity.authTime,cipher,user.session.id).first();
 if(!out)throw new AccountError('SESSION_EXPIRED',401);
 await event(env,user.sub,user.session.id,'reauthenticated').run();
}
export async function beginEnrollment(request,env,user){
 requireRecent(user);if(!user.emailVerified)throw new AccountError('EMAIL_VERIFICATION_REQUIRED',403);
 if(env.ACCOUNT_TOTP_ENABLED!=='true')throw new AccountError('MFA_METHOD_UNAVAILABLE',503);
 await rateLimit(env,request,'mfa-enroll',user.sub,3);
 const result=await firebaseCall(env,'accounts/mfaEnrollment:start',{idToken:user.credentials.idToken,totpEnrollmentInfo:{}},{v2:true}),info=result.totpSessionInfo;
 if(!info||!/^[A-Z2-7]+=*$/.test(info.sharedSecretKey||'')||typeof info.sessionInfo!=='string'||![6,8].includes(info.verificationCodeLength)||!['SHA1','SHA256','SHA512'].includes(info.hashingAlgorithm)||!Number.isInteger(info.periodSec)||info.periodSec<15||info.periodSec>120)throw new AccountError('IDENTITY_UNAVAILABLE',503);
 const challengeId=await saveChallenge(request,env,'mfa_enroll',{sessionInfo:info.sessionInfo},user);
 return {challengeId,secret:info.sharedSecretKey,codeLength:info.verificationCodeLength,algorithm:info.hashingAlgorithm,period:info.periodSec,
  uri:`otpauth://totp/${encodeURIComponent('Uvenaro:'+user.email)}?secret=${info.sharedSecretKey}&issuer=Uvenaro&algorithm=${info.hashingAlgorithm}&digits=${info.verificationCodeLength}&period=${info.periodSec}`};
}
export async function finishEnrollment(request,env,user,input){
 requireRecent(user);if(!/^\d{6,8}$/.test(input.code||''))throw new AccountError('INVALID_VERIFICATION_CODE',401);
 const {row,payload}=await challenge(request,env,input.challengeId,'mfa_enroll',user);
 await firebaseCall(env,'accounts/mfaEnrollment:finalize',{idToken:user.credentials.idToken,displayName:'Uvenaro authenticator',totpVerificationInfo:{sessionInfo:payload.sessionInfo,verificationCode:input.code}},{v2:true});
 await consume(env,row.id);await revokeAll(env,user.sub,'mfa_enrolled');return {ok:true,signInRequired:true};
}
