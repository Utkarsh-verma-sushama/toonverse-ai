import {AccountError,configured,context,email,password,name,json,cookie,readCookie,hash,event,now,rateLimit,accountAllowed,requireAllowedAccount} from './account-common.mjs';
import {firebaseCall,credentials,FirebaseAccountError} from './firebase-accounts.mjs';
import {authenticateAccountRequest,issueSession,refreshSession,profile,verifyCredentials,revoke,revokeAll,requireRecent} from './account-sessions.mjs';
import {mfaRequired,finishMfa,updateReauth,beginEnrollment,finishEnrollment} from './account-mfa.mjs';
const emailContinuation=env=>env.ACCOUNT_ACTION_CONTINUE_URL?{continueUrl:env.ACCOUNT_ACTION_CONTINUE_URL,canHandleCodeInApp:false}:{};
const genericRecovery={ok:true,message:'If the account is eligible, recovery instructions will be sent.'};
const actionCode=value=>{if(typeof value!=='string'||value.length<10||value.length>2048)throw new AccountError('INVALID_ACTION_CODE');return value;};
const all=async statement=>(await statement.all()).results;
function capabilities(env){return {emailPassword:true,emailVerification:true,passwordRecovery:true,profile:true,sessions:true,securityEvents:true,accountExport:true,deletionRequest:true,
 totpEnrollment:env.ACCOUNT_TOTP_ENABLED==='true',providers:[],passkeys:false,phoneOtp:false,recoveryCodes:false};}
function providerFailure(error){
 if(!(error instanceof FirebaseAccountError))return error;
 if(['WEAK_PASSWORD','PASSWORD_DOES_NOT_MEET_REQUIREMENTS'].some(c=>error.providerCode.startsWith(c)))return new AccountError('PASSWORD_POLICY');
 if(['INVALID_OOB_CODE','EXPIRED_OOB_CODE'].includes(error.providerCode))return new AccountError('INVALID_ACTION_CODE');
 if(['INVALID_CODE','INVALID_VERIFICATION_CODE','INVALID_MFA_PENDING_CREDENTIAL','MISSING_MFA_PENDING_CREDENTIAL'].includes(error.providerCode))return new AccountError('INVALID_VERIFICATION_CODE',401);
 if(['OPERATION_NOT_ALLOWED','CONFIGURATION_NOT_FOUND','API_KEY_INVALID','INVALID_API_KEY','PROJECT_NOT_FOUND','PASSWORD_LOGIN_DISABLED'].includes(error.providerCode))return new AccountError('ACCOUNT_NOT_CONFIGURED',503);
 return new AccountError('INVALID_CREDENTIALS',401);
}
async function signIn(request,env,input,register){
 const address=email(input.email),pwd=password(input.password,{newPassword:register}),displayName=register?name(input.name):'';
 await rateLimit(env,request,register?'register':'signin',address,register?4:10);
 requireAllowedAccount(env,address);
 let result;
 try{result=await firebaseCall(env,register?'accounts:signUp':'accounts:signInWithPassword',{email:address,password:pwd,returnSecureToken:true,...(register?{displayName}: {})});}
 catch(error){if(register&&error instanceof FirebaseAccountError&&['EMAIL_EXISTS','INVALID_LOGIN_CREDENTIALS'].includes(error.providerCode))throw new AccountError('ACCOUNT_REGISTRATION_FAILED',400);throw error;}
 if(result.mfaPendingCredential)return mfaRequired(request,env,result);
 const creds=credentials(result),identity=await verifyCredentials(env,creds);
 if(identity.email.toLowerCase()!==address)throw new AccountError('IDENTITY_UNAVAILABLE',503);
 return issueSession(request,env,creds,{displayName,verifiedIdentity:identity});
}
async function signOut(request,env,input){
 const ctx=await context(request,env);let user;
 if(request.headers.has('authorization')){
  try{user=await authenticateAccountRequest(request,env);}catch(error){if(error.status!==401)throw error;}
 }
 if(input.allDevices){if(!user)throw new AccountError('UNAUTHORIZED',401);requireRecent(user);await revokeAll(env,user.sub,'sign_out_all');}
 else if(user)await revoke(env,user.session,'sign_out');
 else{
  const token=readCookie(request);const row=token?await env.DB.prepare(`SELECT s.* FROM account_refresh_tokens t JOIN account_sessions s ON s.id=t.session_id WHERE t.token_hash=?`).bind(await hash(token)).first():null;
  if(row&&row.origin===ctx.origin&&row.device_hash===ctx.deviceHash&&row.revoked_at===null)await revoke(env,row,'sign_out');
 }
 return json({ok:true},200,{'set-cookie':cookie('')});
}
async function exportPage(env,user,input){
 requireRecent(user);
 const resources={
  sessions:['account_sessions','id,device_name,created_at,last_active_at,revoked_at'],
  security:['account_security_events','id,event_type,created_at'],
  billing:['usage_ledger','id,reservation_id,event_type,credits,cost_microusd,metadata_json,created_at'],
  requests:['usage_reservations','id,idempotency_key,feature,status,estimated_credits,actual_credits,created_at,settled_at'],
  billingAccount:['(SELECT owner_id AS id, * FROM billing_accounts)','id,plan_id,status,included_credits,prepaid_credits,reserved_credits,cycle_started_at,cycle_ends_at,updated_at'],
  limits:['(SELECT owner_id AS id, * FROM usage_limits)','id,daily_credit_limit,monthly_credit_limit,max_request_cost_microusd,requests_per_minute,blocked_until,updated_at'],
  steps:['(SELECT s.*,r.owner_id FROM agent_steps s JOIN agent_runs r ON r.id=s.run_id)','id,run_id,sequence_no,tool_name,status,input_hash,output_ref,cost_usd,started_at,finished_at'],
  approvals:['agent_approvals','id,run_id,action_type,summary,decision,reason,expires_at,decided_at'],
  agents:['agent_runs','id,status,objective,payload_json,error_code,created_at,updated_at'],
  routing:['route_decisions','id,task,modalities_json,policy_json,selected_provider,selected_model,fallback_json,created_at'],
  audit:['audit_events','id,action,resource_type,resource_id,details_json,created_at'],
  deletion:['account_deletion_requests','id,status,requested_at,eligible_at,completed_at']
 };
 const resource=input.resource||'security',cursor=input.cursor||'';
 if(!Object.hasOwn(resources,resource)||typeof cursor!=='string'||cursor.length>200)throw new AccountError('INVALID_EXPORT_PAGE');
 const [table,columns]=resources[resource];
 const rows=await all(env.DB.prepare(`SELECT ${columns} FROM ${table} WHERE owner_id=? AND id>? ORDER BY id LIMIT 101`).bind(user.sub,cursor));
 const page=rows.slice(0,100);
 return {version:1,generatedAt:new Date().toISOString(),user:await profile(env,user),scope:'Account and server records; local creative files are exported separately from My Library.',resources:Object.keys(resources),resource,records:page,nextCursor:rows.length>100?page.at(-1).id:null};
}
export async function accountRoute(request,env,readBody){
 const path=new URL(request.url).pathname,method=request.method;
 if(!path.startsWith('/v1/auth/')&&!path.startsWith('/v1/account/'))return null;
 try{
  configured(env);
  // Every account request, including login and cookie restore, requires an
  // exact trusted origin and a custom header (therefore a CORS preflight).
  await context(request,env);
  if(path==='/v1/auth/capabilities'&&method==='GET')return json(capabilities(env));
  const input=method==='POST'?await readBody(request):{};
  if(['/v1/auth/sign-in','/v1/auth/register'].includes(path)&&method==='POST')return await signIn(request,env,input,path.endsWith('/register'));
  if(['/v1/auth/session','/v1/auth/refresh'].includes(path)&&method==='POST')return await refreshSession(request,env);
  if(path==='/v1/auth/sign-out'&&method==='POST')return await signOut(request,env,input);
  if(path==='/v1/auth/mfa/challenge'&&method==='POST')return await finishMfa(request,env,input);
  if(['/v1/auth/password/reset/request','/v1/auth/recovery/start'].includes(path)&&method==='POST'){
   const address=email(input.email||input.identifier);await rateLimit(env,request,'password-reset',address,3,3600000);
   if(!accountAllowed(env,address))return json(genericRecovery);
   try{await firebaseCall(env,'accounts:sendOobCode',{requestType:'PASSWORD_RESET',email:address,...emailContinuation(env)});}
   catch(error){if(!(error instanceof FirebaseAccountError)||!['EMAIL_NOT_FOUND','USER_DISABLED'].includes(error.providerCode))throw error;}
   return json(genericRecovery);
  }
  if(path==='/v1/auth/password/reset/confirm'&&method==='POST'){
   const code=actionCode(input.oobCode),newPassword=password(input.newPassword,{newPassword:true});
   await rateLimit(env,request,'reset-confirm',code,5);
   const checked=await firebaseCall(env,'accounts:resetPassword',{oobCode:code});
   if(checked.requestType!=='PASSWORD_RESET')throw new AccountError('INVALID_ACTION_CODE');
   const address=email(checked.email);requireAllowedAccount(env,address);const owners=await all(env.DB.prepare('SELECT owner_id FROM account_profiles WHERE email=?').bind(address));
   for(const item of owners)await revokeAll(env,item.owner_id,'password_reset_started');
   await firebaseCall(env,'accounts:resetPassword',{oobCode:code,newPassword});
   return json({ok:true,signInRequired:true},200,{'set-cookie':cookie('')});
  }
  if(path==='/v1/auth/email/verify/confirm'&&method==='POST'){
   const code=actionCode(input.oobCode);await rateLimit(env,request,'email-confirm',code,5);
   if(env.ACCOUNT_ALLOWED_EMAILS!==undefined){const checked=await firebaseCall(env,'accounts:resetPassword',{oobCode:code});if(!['VERIFY_EMAIL','VERIFY_AND_CHANGE_EMAIL','RECOVER_EMAIL'].includes(checked.requestType))throw new AccountError('INVALID_ACTION_CODE');const addresses=[checked.email,checked.newEmail].filter(Boolean);if(!addresses.length)throw new AccountError('INVALID_ACTION_CODE');for(const address of addresses)requireAllowedAccount(env,address);}
   await firebaseCall(env,'accounts:update',{oobCode:code});return json({ok:true});
  }
  const user=await authenticateAccountRequest(request,env);
  if(path==='/v1/account/profile'&&method==='GET')return json({user:await profile(env,user)});
  if(path==='/v1/account/profile'&&method==='POST'){
   const displayName=name(input.name),locale=input.locale||'en',timezone=input.timezone||'UTC';
   try{new Intl.DateTimeFormat(locale,{timeZone:timezone});}catch{throw new AccountError('INVALID_PREFERENCES');}
   if(typeof locale!=='string'||locale.length>35||typeof timezone!=='string'||timezone.length>64)throw new AccountError('INVALID_PREFERENCES');
   await env.DB.batch([env.DB.prepare('UPDATE account_profiles SET display_name=?,locale=?,timezone=?,updated_at=? WHERE owner_id=?').bind(displayName,locale,timezone,now(),user.sub),event(env,user.sub,user.session.id,'profile_updated')]);
   return json({user:await profile(env,user)});
  }
  if(path==='/v1/auth/reauthenticate'&&method==='POST'){
   await rateLimit(env,request,'reauthenticate',user.sub,5);
   const result=await firebaseCall(env,'accounts:signInWithPassword',{email:user.email,password:password(input.password),returnSecureToken:true});
   if(result.mfaPendingCredential)return mfaRequired(request,env,result,user);
   const creds=credentials(result);await updateReauth(env,user,creds,await verifyCredentials(env,creds));return json({ok:true});
  }
  if(path==='/v1/auth/reauthenticate/mfa'&&method==='POST')return json(await finishMfa(request,env,input,user));
  if(path==='/v1/auth/email/verify/request'&&method==='POST'){
   if(user.emailVerified)return json({ok:true,alreadyVerified:true});
   await rateLimit(env,request,'verification-mail',user.sub,3,3600000);
   await firebaseCall(env,'accounts:sendOobCode',{requestType:'VERIFY_EMAIL',idToken:user.credentials.idToken,...emailContinuation(env)});return json({ok:true});
  }
  if(path==='/v1/auth/password/change'&&method==='POST'){
   requireRecent(user);await rateLimit(env,request,'password-change',user.sub,5,3600000);
   const newPassword=password(input.newPassword,{newPassword:true});
   await revokeAll(env,user.sub,'password_change_started');
   await firebaseCall(env,'accounts:update',{idToken:user.credentials.idToken,password:newPassword,returnSecureToken:false});
   return json({ok:true,signInRequired:true},200,{'set-cookie':cookie('')});
  }
  if(path==='/v1/auth/email/change/request'&&method==='POST'){
   requireRecent(user);const newEmail=email(input.email);requireAllowedAccount(env,newEmail);await rateLimit(env,request,'email-change',user.sub,3,3600000);
   await firebaseCall(env,'accounts:sendOobCode',{requestType:'VERIFY_AND_CHANGE_EMAIL',idToken:user.credentials.idToken,newEmail,...emailContinuation(env)});
   await event(env,user.sub,user.session.id,'email_change_requested').run();return json({ok:true});
  }
  if(path==='/v1/auth/sessions'&&method==='GET'){
   const rows=await all(env.DB.prepare('SELECT id,device_name,created_at,last_active_at FROM account_sessions WHERE owner_id=? AND revoked_at IS NULL AND expires_at>? AND idle_expires_at>? ORDER BY created_at DESC LIMIT 20').bind(user.sub,now(),now()));
   return json({sessions:rows.map(r=>({id:r.id,deviceName:r.device_name,createdAt:r.created_at,lastActiveAt:r.last_active_at,current:r.id===user.session.id}))});
  }
  const sessionPath=path.match(/^\/v1\/auth\/sessions\/([A-Za-z0-9-]{1,64})$/);
  if(sessionPath&&method==='DELETE'){
   const row=await env.DB.prepare('SELECT id,owner_id FROM account_sessions WHERE id=? AND owner_id=? AND revoked_at IS NULL').bind(sessionPath[1],user.sub).first();
   if(!row)throw new AccountError('NOT_FOUND',404);await revoke(env,row,'session_revoked');return json({ok:true,current:row.id===user.session.id},200,row.id===user.session.id?{'set-cookie':cookie('')}:{});
  }
  if(path==='/v1/auth/sessions/revoke-others'&&method==='POST'){await revokeAll(env,user.sub,'other_sessions_revoked',user.session.id);return json({ok:true});}
  if(path==='/v1/auth/security/events'&&method==='GET'){
   const raw=new URL(request.url).searchParams.get('limit')||'25';if(!/^\d{1,3}$/.test(raw))throw new AccountError('INVALID_LIMIT');const limit=Math.min(100,Math.max(1,Number(raw)));
   return json({events:await all(env.DB.prepare('SELECT id,event_type AS type,created_at AS createdAt FROM account_security_events WHERE owner_id=? ORDER BY created_at DESC LIMIT ?').bind(user.sub,limit))});
  }
  if(path==='/v1/auth/security'&&method==='GET')return json({emailVerified:user.emailVerified,mfaEnabled:user.mfaEnabled,mfaMethods:user.mfaMethods,recentAuthentication:now()-user.session.authenticated_at<300000,capabilities:capabilities(env)});
  if(path==='/v1/auth/connections'&&method==='GET')return json({connections:user.providers.map(provider=>({provider,label:provider,status:'Sign-in method',requiredForSignIn:true}))});
  if(path==='/v1/auth/mfa/totp/enroll'&&method==='POST')return json(await beginEnrollment(request,env,user));
  if(path==='/v1/auth/mfa/totp/confirm'&&method==='POST')return json(await finishEnrollment(request,env,user,input),200,{'set-cookie':cookie('')});
  const mfaPath=path.match(/^\/v1\/auth\/mfa\/([^/]+)$/);
  if(mfaPath&&method==='DELETE'){
   requireRecent(user);const id=decodeURIComponent(mfaPath[1]);if(!user.mfaMethods.some(m=>m.id===id))throw new AccountError('NOT_FOUND',404);
   await firebaseCall(env,'accounts/mfaEnrollment:withdraw',{idToken:user.credentials.idToken,mfaEnrollmentId:id},{v2:true});
   await revokeAll(env,user.sub,'mfa_removed');return json({ok:true,signInRequired:true},200,{'set-cookie':cookie('')});
  }
  if(path==='/v1/account/export'&&method==='POST')return json(await exportPage(env,user,input));
  if(path==='/v1/account/deletion'&&method==='GET')return json({request:await env.DB.prepare("SELECT id,status,requested_at AS requestedAt,eligible_at AS eligibleAt FROM account_deletion_requests WHERE owner_id=? AND status='pending_review'").bind(user.sub).first()});
  if(path==='/v1/account/deletion/request'&&method==='POST'){
   requireRecent(user);if(input.confirmation!=='DELETE')throw new AccountError('CONFIRMATION_REQUIRED');
   if(!user.emailVerified)throw new AccountError('EMAIL_VERIFICATION_REQUIRED',403);
   const at=now();await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO account_deletion_requests (id,owner_id,status,requested_at,eligible_at) VALUES (?,?,'pending_review',?,?)").bind(crypto.randomUUID(),user.sub,at,at+7*86400000),
    env.DB.prepare("UPDATE account_profiles SET status='deletion_requested',updated_at=? WHERE owner_id=?").bind(at,user.sub),
    event(env,user.sub,user.session.id,'deletion_requested')
   ]);await revokeAll(env,user.sub,'deletion_requested',user.session.id);
   return json({ok:true,status:'pending_review',message:'Deletion requested. Your data has not yet been deleted. Review and retention checks are required.'},202);
  }
  if(path==='/v1/account/deletion/cancel'&&method==='POST'){
   requireRecent(user);await env.DB.batch([
    env.DB.prepare("UPDATE account_deletion_requests SET status='cancelled' WHERE owner_id=? AND status='pending_review'").bind(user.sub),
    env.DB.prepare("UPDATE account_profiles SET status='active',updated_at=? WHERE owner_id=?").bind(now(),user.sub),event(env,user.sub,user.session.id,'deletion_cancelled')
   ]);return json({ok:true});
  }
  return json({code:'ACCOUNT_METHOD_UNAVAILABLE'},501);
 }catch(original){
  if(['JSON_REQUIRED','REQUEST_TOO_LARGE','INVALID_JSON'].includes(original.code))return json({code:original.code},original.status);
  const error=providerFailure(original);
  if(error instanceof AccountError)return json({code:error.code,...error.extra},error.status,error.status===429?{'retry-after':String(error.extra.retryAfter||60)}:{});
  if(error.status===401)return json({code:'UNAUTHORIZED'},401);
  // No credentials, upstream error text, email addresses or request bodies in logs.
  return json({code:'ACCOUNT_SERVICE_UNAVAILABLE'},503);
 }
}
