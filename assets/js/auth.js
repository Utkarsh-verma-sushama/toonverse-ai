(() => {
 'use strict';
 const listeners=new Set(),DEVICE='uvenaro:auth:device-id',LOGOUT='uvenaro:auth:logout',BLOCKED='uvenaro:auth:blocked-restore';
 let accessToken='',epoch=0,refreshPromise=null,restorePromise=null,authBusy=false,capabilities=null,volatileDevice='';
 let localLogout=false;
 const blocked=()=>{try{return localLogout||localStorage.getItem(BLOCKED)==='true';}catch{return localLogout;}};
 const connected=()=>Boolean(window.UvenaroConfig?.features?.authentication&&window.UvenaroConfig?.services?.apiBaseUrl);
 let state={status:'signed-out',user:null,expiresAt:0,backendConnected:connected(),lastError:''};
 const errors={
  ACCOUNT_NOT_IN_PILOT:'This account test is limited to invited email addresses.',
  ACCOUNT_SERVICE_DISABLED:'Account service is not enabled yet.',ACCOUNT_NOT_CONFIGURED:'Account service is not ready yet.',
  ACCOUNT_SERVICE_UNAVAILABLE:'Account service is temporarily unavailable.',IDENTITY_UNAVAILABLE:'Sign-in service is temporarily unavailable.',
  INVALID_CREDENTIALS:'Email or password could not be verified.',ACCOUNT_REGISTRATION_FAILED:'Account could not be created. Try signing in or resetting your password.',
  PASSWORD_POLICY:'Use a password with 12–128 characters that meets the account password requirements.',
  INVALID_EMAIL:'Enter a valid email address.',INVALID_NAME:'Enter a name with 1–80 characters.',
  TOO_MANY_ATTEMPTS:'Too many attempts. Please wait before trying again.',RECENT_AUTH_REQUIRED:'Confirm your password again before making this change.',
  SESSION_EXPIRED:'Your session has expired. Please sign in again.',SESSION_REFRESH_BUSY:'Another tab is refreshing this session. Try again shortly.',
  SESSION_CONTEXT_MISMATCH:'Sign in again on this device.',UNAUTHORIZED:'Please sign in again.',
  MFA_REQUIRED:'Enter the code from your authenticator app.',INVALID_VERIFICATION_CODE:'That verification code could not be confirmed.',
  INVALID_CHALLENGE:'This verification has expired. Start again.',INVALID_ACTION_CODE:'This email link is invalid, expired or already used.',
  EMAIL_VERIFICATION_REQUIRED:'Verify your email address first.',ACCOUNT_METHOD_UNAVAILABLE:'This sign-in method is not available yet.',
  MFA_METHOD_UNAVAILABLE:'This authenticator method is not available for this account service.',
  AUTH_CANCELLED:'Account request was cancelled.',NETWORK_ERROR:'The connection ended before the result was confirmed. Please try again.'
 };
 const error=(code,extra={})=>Object.assign(new Error(errors[code]||'The account action could not finish.'),{code,...extra});
 function getState(){return {...state,user:state.user?{...state.user,entitlements:[...(state.user.entitlements||[])]}:null};}
 function emit(patch){state={...state,...patch};const snapshot=getState();for(const fn of listeners){try{fn(snapshot);}catch{}}window.dispatchEvent(new CustomEvent('uvenaro:auth-change',{detail:snapshot}));return snapshot;}
 function device(){
  if(volatileDevice)return volatileDevice;
  try{const value=localStorage.getItem(DEVICE);if(/^[A-Za-z0-9_-]{16,128}$/.test(value||''))return volatileDevice=value;}catch{}
  volatileDevice=crypto.randomUUID();try{localStorage.setItem(DEVICE,volatileDevice);}catch{}return volatileDevice;
 }
 function endpoint(path){
  if(!connected())throw error('ACCOUNT_SERVICE_DISABLED');
  const base=String(window.UvenaroConfig.services.apiBaseUrl).replace(/\/$/,'');
  const url=new URL(base+path,location.href);if(url.protocol!=='https:')throw error('ACCOUNT_NOT_CONFIGURED');return url.href;
 }
 async function request(path,{body,method='POST',authenticated=false,token=accessToken}={}){
  if(authenticated)token=await getAccessToken();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
   let response;try{response=await fetch(endpoint(path),{method,credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal,
    headers:{accept:'application/json','x-uvenaro-device':device(),'x-uvenaro-csrf':'1',...(method==='POST'?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},
    ...(method==='POST'?{body:JSON.stringify(body||{})}:{})});}catch(e){if(e.code)throw e;throw error('NETWORK_ERROR');}
   const payload=await response.json().catch(()=>({}));
   if(!response.ok){if(authenticated&&['UNAUTHORIZED','SESSION_EXPIRED'].includes(payload.code))clear(payload.code);throw error(payload.code||'ACCOUNT_SERVICE_UNAVAILABLE',{challengeId:payload.challengeId,methods:payload.methods,retryAfter:payload.retryAfter});}
   return payload;
  }finally{clearTimeout(timer);}
 }
 function accept(payload,version){
  if(version!==epoch)throw error('AUTH_CANCELLED');
  if(!/^uv1\.[A-Za-z0-9_-]{43}$/.test(payload.accessToken||'')||!payload.user?.id||!Number.isFinite(payload.expiresAt)||payload.expiresAt<=Date.now())throw error('SESSION_EXPIRED');
  accessToken=payload.accessToken;
  return emit({status:'signed-in',user:{...payload.user,entitlements:Array.isArray(payload.user.entitlements)?payload.user.entitlements:[]},expiresAt:payload.expiresAt,lastError:''});
 }
 function clear(code=''){epoch++;accessToken='';return emit({status:'signed-out',user:null,expiresAt:0,lastError:code});}
 async function authOperation(path,body){
  if(authBusy)throw error('AUTH_CANCELLED');authBusy=true;const version=++epoch;accessToken='';emit({status:'signing-in',user:null,expiresAt:0,lastError:''});
  try{const payload=await request(path,{body,token:''});
   if(version!==epoch){try{await request('/v1/auth/sign-out',{token:payload.accessToken});}catch{}throw error('AUTH_CANCELLED');}
   const accepted=accept(payload,version);localLogout=false;try{localStorage.removeItem(BLOCKED);}catch{}return accepted;}
  catch(e){if(version===epoch)emit({status:e.code==='MFA_REQUIRED'?'mfa-required':'signed-out',lastError:e.code});throw e;}
  finally{authBusy=false;}
 }
 async function refresh(){
  if(blocked())throw error('UNAUTHORIZED');
  if(authBusy)throw error('AUTH_CANCELLED');if(refreshPromise)return refreshPromise;
  const version=epoch;
  const run=async()=>{
   const refreshCall=()=>request('/v1/auth/refresh',{token:''});
   const payload=navigator.locks?.request?await navigator.locks.request('uvenaro-auth-refresh',refreshCall):await refreshCall();
   return accept(payload,version);
  };
  refreshPromise=run().catch(e=>{if(version===epoch&&['UNAUTHORIZED','SESSION_EXPIRED','SESSION_CONTEXT_MISMATCH'].includes(e.code))clear(e.code);throw e;}).finally(()=>{refreshPromise=null;});
  return refreshPromise;
 }
 async function restore(){
  if(!connected()||blocked())return getState();if(restorePromise)return restorePromise;if(state.status==='signed-in')return getState();
  emit({status:'restoring'});restorePromise=refresh().catch(e=>{if(state.status==='restoring')emit({status:'signed-out',lastError:e.code});return getState();}).finally(()=>{restorePromise=null;});return restorePromise;
 }
 async function getAccessToken(){if(!accessToken||state.expiresAt-Date.now()<60000)await refresh();if(!accessToken)throw error('UNAUTHORIZED');return accessToken;}
 async function signOut({allDevices=false}={}){
  if(allDevices){const security=await request('/v1/auth/security',{method:'GET',authenticated:true});if(!security.recentAuthentication)throw error('RECENT_AUTH_REQUIRED');}
  const token=accessToken;localLogout=true;clear();try{localStorage.setItem(BLOCKED,'true');localStorage.setItem(LOGOUT,String(Date.now()));localStorage.removeItem('uvenaro:auth:session-hint');}catch{}
  if(!connected())return getState();
  // Local sign-out is immediate. A server failure remains visible to the caller.
  await request('/v1/auth/sign-out',{body:{allDevices},token});return getState();
 }
 window.addEventListener('storage',event=>{if(event.key===LOGOUT){localLogout=true;clear();}else if(event.key===BLOCKED&&event.newValue===null)localLogout=false;});
 const protectedCall=(path,body={},method='POST')=>request(path,{body,method,authenticated:true});
 const unavailable=async()=>{throw error('ACCOUNT_METHOD_UNAVAILABLE');};
 window.UvenaroAuth=Object.freeze({
  getState,restore,getAccessToken,signOut,
  subscribe(fn){listeners.add(fn);fn(getState());return()=>listeners.delete(fn);},
  async getCapabilities(){if(!capabilities)capabilities=await request('/v1/auth/capabilities',{method:'GET',token:''});return {...capabilities};},
  signInWithEmail:(email,password)=>authOperation('/v1/auth/sign-in',{email,password}),
  createAccount:profile=>authOperation('/v1/auth/register',profile),
  completeMfa:(challengeId,methodId,code)=>authOperation('/v1/auth/mfa/challenge',{challengeId,methodId,code}),
  reauthenticate:password=>protectedCall('/v1/auth/reauthenticate',{password}),
  completeReauthentication:(challengeId,methodId,code)=>protectedCall('/v1/auth/reauthenticate/mfa',{challengeId,methodId,code}),
  async getProfile(){const out=await protectedCall('/v1/account/profile',{},'GET');if(state.user?.id===out.user?.id)emit({user:out.user});return out.user;},
  async updateProfile(profile){const out=await protectedCall('/v1/account/profile',profile);if(state.user?.id===out.user?.id)emit({user:out.user});return out.user;},
  requestPasswordReset:email=>request('/v1/auth/password/reset/request',{body:{email},token:''}),
  beginRecovery:identifier=>request('/v1/auth/recovery/start',{body:{identifier},token:''}),
  confirmPasswordReset:(oobCode,newPassword)=>request('/v1/auth/password/reset/confirm',{body:{oobCode,newPassword},token:''}),
  confirmEmailVerification:oobCode=>request('/v1/auth/email/verify/confirm',{body:{oobCode},token:''}),
  requestEmailVerification:()=>protectedCall('/v1/auth/email/verify/request'),
  requestEmailChange:email=>protectedCall('/v1/auth/email/change/request',{email}),
  async changePassword(newPassword){const out=await protectedCall('/v1/auth/password/change',{newPassword});clear();return out;},
  async listSessions(){return (await protectedCall('/v1/auth/sessions',{},'GET')).sessions||[];},
  revokeSession:id=>protectedCall('/v1/auth/sessions/'+encodeURIComponent(id),{},'DELETE'),
  signOutOtherDevices:()=>protectedCall('/v1/auth/sessions/revoke-others'),
  async listSecurityEvents({limit=25}={}){return (await protectedCall('/v1/auth/security/events?limit='+Math.max(1,Math.min(100,limit)),{},'GET')).events||[];},
  async listConnections(){return (await protectedCall('/v1/auth/connections',{},'GET')).connections||[];},
  getSecurityOverview:()=>protectedCall('/v1/auth/security',{},'GET'),
  beginTotpEnrollment:()=>protectedCall('/v1/auth/mfa/totp/enroll'),
  async confirmTotpEnrollment(challengeId,code){const out=await protectedCall('/v1/auth/mfa/totp/confirm',{challengeId,code});clear();return out;},
  async removeMfa(id){const out=await protectedCall('/v1/auth/mfa/'+encodeURIComponent(id),{},'DELETE');clear();return out;},
  requestDataExport:(page={})=>protectedCall('/v1/account/export',page),
  requestAccountDeletion:confirmation=>protectedCall('/v1/account/deletion/request',{confirmation}),
  getDeletionStatus:()=>protectedCall('/v1/account/deletion',{},'GET'),
  cancelAccountDeletion:()=>protectedCall('/v1/account/deletion/cancel'),
  beginProvider:unavailable,beginPasskey:unavailable,sendOtp:unavailable,verifyOtp:unavailable,
  beginAccountLink:unavailable,confirmAccountLink:unavailable,resolveAccountConflict:unavailable,disconnectProvider:unavailable,
  verifyRecovery:unavailable,completeRecovery:unavailable,requestDeviceVerification:unavailable,verifyDevice:unavailable,rotateRecoveryCodes:unavailable
 });
})();
