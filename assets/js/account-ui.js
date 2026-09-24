(() => {
 'use strict';
 const auth=window.UvenaroAuth,$=id=>document.getElementById(id),status=$('service-status'),dashboard=$('account-dashboard');
 let caps={},registering=false,loading=0;
 function notice(message,ok=false){status.textContent=message;status.className='status '+(ok?'success':'warning');$('announce').textContent=message;}
 const date=value=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 function step(title,fields,action,description=''){
  return new Promise((resolve,reject)=>{
   const dialog=$('account-step'),form=$('step-form'),container=$('step-fields');let busy=false;
   $('step-title').textContent=title;$('step-description').textContent=description;$('step-error').textContent='';container.replaceChildren();
   for(const f of fields){const label=document.createElement('label');label.className='field';const span=document.createElement('span');span.textContent=f.label;const input=document.createElement(f.options?'select':'input');input.name=f.name;input.id='step-'+f.name;
    if(f.options)for(const option of f.options){const node=document.createElement('option');node.value=option.id;node.textContent=option.name;input.append(node);}
    else{input.type=f.type||'text';input.autocomplete=f.autocomplete||'off';if(f.pattern)input.pattern=f.pattern;if(f.inputmode)input.inputMode=f.inputmode;if(f.min)input.minLength=f.min;input.maxLength=f.max||128;}
    input.required=true;label.append(span,input);container.append(label);
   }
   const clear=()=>{dialog.close();container.replaceChildren();$('step-description').textContent='';form.onsubmit=null;dialog.oncancel=null;$('step-cancel').onclick=null;};
   const cancel=()=>{if(busy)return;clear();reject(Object.assign(new Error('Cancelled.'),{code:'UI_CANCELLED'}));};
   $('step-cancel').onclick=cancel;dialog.oncancel=e=>{e.preventDefault();cancel();};
   form.onsubmit=async e=>{e.preventDefault();if(busy||!form.reportValidity())return;busy=true;$('step-submit').disabled=$('step-cancel').disabled=true;
    try{const values=Object.fromEntries(new FormData(form));const result=await action(values);clear();resolve(result);}
    catch(error){$('step-error').textContent=error.message;}
    finally{busy=false;$('step-submit').disabled=$('step-cancel').disabled=false;}
   };
   dialog.showModal();container.querySelector('input,select')?.focus();
  });
 }
 function mfa(error,reauth=false){return step('Authenticator code',[{name:'method',label:'Authenticator',options:error.methods||[]},{name:'code',label:'Verification code',inputmode:'numeric',pattern:'[0-9]{6,8}',max:8,autocomplete:'one-time-code'}],v=>reauth?auth.completeReauthentication(error.challengeId,v.method,v.code):auth.completeMfa(error.challengeId,v.method,v.code));}
 async function sensitive(action){
  try{return await action();}catch(error){if(error.code!=='RECENT_AUTH_REQUIRED')throw error;}
  let challenge;
  await step('Confirm your identity',[{name:'password',label:'Current password',type:'password',autocomplete:'current-password'}],async v=>{try{return await auth.reauthenticate(v.password);}catch(error){if(error.code!=='MFA_REQUIRED')throw error;challenge=error;}});
  if(challenge)await mfa(challenge,true);return action();
 }
 async function run(button,action,success){button.disabled=true;try{await action();if(success)notice(success,true);await loadDashboard();}catch(error){if(error.code!=='UI_CANCELLED')notice(error.message);}finally{button.disabled=false;updateControls();}}
 function row(title,detail,action,callback){const el=document.createElement('div');el.className='data-row';const text=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('span');strong.textContent=title;small.className='data-meta';small.textContent=detail;text.append(strong,small);el.append(text);if(action){const button=document.createElement('button');button.type='button';button.className='security-action';button.textContent=action;button.onclick=()=>run(button,callback);el.append(button);}return el;}
 function list(id,values,renderer,empty){$(id).replaceChildren(...(values.length?values.map(renderer):[row(empty,'')]));}
 function updateControls(){
  const signed=auth.getState().status==='signed-in';$('signin-controls').hidden=signed;$('submit').disabled=!caps.emailPassword;$('forgot-password').disabled=!caps.passwordRecovery;
  for(const button of document.querySelectorAll('[data-provider],#passkey,[data-link-provider]'))button.disabled=true;
  const ready={sessions:true,activity:true,connections:true,mfa:caps.totpEnrollment,'export-data':true,'signout-others':true};
  for(const button of document.querySelectorAll('[data-security-action]'))button.disabled=!signed||!ready[button.dataset.securityAction];
 }
 async function loadDashboard(){
  const version=++loading,snapshot=auth.getState();updateControls();if(snapshot.status!=='signed-in'){dashboard.hidden=true;return;}
  dashboard.hidden=false;
  try{
   const [user,sessions,events,connections,security,deletion]=await Promise.all([auth.getProfile(),auth.listSessions(),auth.listSecurityEvents(),auth.listConnections(),auth.getSecurityOverview(),auth.getDeletionStatus()]);
   if(version!==loading||auth.getState().user?.id!==snapshot.user.id)return;
   $('profile-name').textContent=user.name||'Uvenaro user';$('profile-email').textContent=user.email;$('profile-avatar').textContent=(user.name||user.email).slice(0,2).toUpperCase();
   $('profile-security').textContent=(user.emailVerified?'Email verified':'Email verification needed')+' · '+(user.mfaEnabled?'Authenticator enabled':'Authenticator not enabled');
   $('verify-email').disabled=user.emailVerified;$('edit-name').value=user.name;$('edit-locale').value=user.locale;$('edit-timezone').value=user.timezone;
   list('session-list',sessions,s=>row(s.deviceName+(s.current?' (current)':''),'Last active '+date(s.lastActiveAt),s.current?'':'Sign out',()=>auth.revokeSession(s.id)),'No active sessions.');
   list('activity-list',events,e=>row(e.type.replaceAll('_',' '),date(e.createdAt)),'No security events.');
   list('connection-list',connections,c=>row(c.label,c.status),'No external sign-in methods.');
   list('mfa-methods',security.mfaMethods||[],m=>row(m.name,'Authenticator method','Remove',()=>sensitive(()=>auth.removeMfa(m.id))),'No authenticator enrolled.');
   $('deletion-status').textContent=deletion.request?'Deletion requested on '+date(deletion.request.requestedAt)+'. Awaiting review; your data has not yet been deleted.':'';
   $('cancel-deletion').hidden=!deletion.request;
  }catch(error){if(version===loading)notice(error.message);}
 }
 async function downloadExport(){
  const first=await sensitive(()=>auth.requestDataExport()),owner=first.user.id,result={version:first.version,user:first.user,scope:first.scope,generatedAt:first.generatedAt,records:{}};let bytes=0,pages=0;
  for(const resource of first.resources){let cursor='';result.records[resource]=[];do{
   if(auth.getState().user?.id!==owner)throw new Error('Account changed. Start the export again.');
   const page=resource===first.resource&&!cursor?first:await auth.requestDataExport({resource,cursor});
   bytes+=JSON.stringify(page.records).length;pages++;if(bytes>20*1024*1024||pages>200)throw new Error('This export is too large for a single device download. Use the paginated account export API or contact support.');
   result.records[resource].push(...page.records);cursor=page.nextCursor;notice('Preparing your account export…');
  }while(cursor);}
  const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='Uvenaro-account-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 function mode(value){registering=value;$('name-field').hidden=!value;$('name').required=value;$('password').minLength=value?12:1;$('password').autocomplete=value?'new-password':'current-password';$('submit').textContent=value?'Create account':'Sign in';for(const [id,active] of [['sign-in-tab',!value],['register-tab',value]]){$(id).setAttribute('aria-selected',String(active));$(id).classList.toggle('active',active);}}
 $('sign-in-tab').onclick=()=>mode(false);$('register-tab').onclick=()=>mode(true);
 $('account-form').onsubmit=async e=>{e.preventDefault();if($('submit').disabled||!e.target.reportValidity())return;const button=$('submit');button.disabled=true;
  try{try{if(registering)await auth.createAccount({name:$('name').value,email:$('email').value,password:$('password').value});else await auth.signInWithEmail($('email').value,$('password').value);}catch(error){if(error.code!=='MFA_REQUIRED')throw error;await mfa(error);}
   notice(auth.getState().user.emailVerified?'Signed in.':'Signed in. Verify your email before using online creative services.',true);await loadDashboard();
  }catch(error){if(error.code!=='UI_CANCELLED')notice(error.message);}finally{$('password').value='';updateControls();}
 };
 $('forgot-password').onclick=()=>run($('forgot-password'),()=>step('Reset your password',[{name:'email',label:'Email address',type:'email',autocomplete:'email',max:254}],v=>auth.requestPasswordReset(v.email)),'If the account is eligible, a reset email will be sent.');
 $('sign-out').onclick=()=>run($('sign-out'),()=>auth.signOut(),'Signed out.');
 $('refresh-dashboard').onclick=()=>run($('refresh-dashboard'),async()=>{await auth.restore();},'Account refreshed.');
 $('verify-email').onclick=()=>run($('verify-email'),()=>auth.requestEmailVerification(),'Verification email requested. Open the link in your inbox, then refresh your account.');
 $('change-email').onclick=()=>run($('change-email'),async()=>{const address=await step('Change email address',[{name:'email',label:'New email address',type:'email',max:254,autocomplete:'email'}],v=>v.email);await sensitive(()=>auth.requestEmailChange(address));},'Verification requested for the new address. Your sign-in email changes only after verification.');
 $('profile-form').onsubmit=e=>{e.preventDefault();run(e.target.querySelector('button'),()=>auth.updateProfile({name:$('edit-name').value,locale:$('edit-locale').value,timezone:$('edit-timezone').value}),'Account details saved.');};
 $('change-password').onclick=()=>run($('change-password'),async()=>{
  const value=await step('New password',[{name:'password',label:'New password (12–128 characters)',type:'password',autocomplete:'new-password',min:12},{name:'confirm',label:'Confirm new password',type:'password',autocomplete:'new-password',min:12}],v=>{if(v.password!==v.confirm)throw new Error('Passwords do not match.');return v.password;});
  await sensitive(()=>auth.changePassword(value));
 },'Password changed. Sign in again on your devices.');
 $('signout-all').onclick=()=>run($('signout-all'),()=>sensitive(()=>auth.signOut({allDevices:true})),'All account sessions signed out.');
 $('dashboard-export').onclick=()=>run($('dashboard-export'),downloadExport,'Account export downloaded. Local creative projects are exported from My Library.');
 $('delete-account').onclick=()=>run($('delete-account'),async()=>{
  await step('Request account deletion',[{name:'confirmation',label:'Type DELETE to request deletion',max:6}],async v=>{if(v.confirmation!=='DELETE')throw new Error('Type DELETE to confirm.');});
  await sensitive(()=>auth.requestAccountDeletion('DELETE'));
 },'Deletion requested and awaiting review. Your data has not yet been deleted.');
 $('cancel-deletion').onclick=()=>run($('cancel-deletion'),()=>sensitive(()=>auth.cancelAccountDeletion()),'Deletion request cancelled.');
 for(const button of document.querySelectorAll('[data-security-action]'))button.onclick=()=>run(button,async()=>{
  const action=button.dataset.securityAction;
  if(action==='mfa'){
   const setup=await sensitive(()=>auth.beginTotpEnrollment());
   await step('Connect your authenticator',[{name:'code',label:'Code from your authenticator app',inputmode:'numeric',pattern:'[0-9]{6,8}',max:8,autocomplete:'one-time-code'}],v=>auth.confirmTotpEnrollment(setup.challengeId,v.code),`Add this setup key to your authenticator app: ${setup.secret}. Algorithm ${setup.algorithm}, ${setup.codeLength} digits, interval ${setup.period} seconds. Keep the key private.`);
   notice('Authenticator added. Sign in again with your password and authenticator.',true);
  }else if(action==='export-data')await downloadExport();else if(action==='signout-others'){await auth.signOutOtherDevices();notice('Other sessions signed out.',true);}else await loadDashboard();
 });
 auth.subscribe(snapshot=>{if(snapshot.status!=='signed-in'){loading++;dashboard.hidden=true;}updateControls();});
 async function init(){
  if(!auth.getState().backendConnected){updateControls();return;}
  try{
   caps=await auth.getCapabilities();updateControls();notice('Account service is ready.',true);
   const query=new URLSearchParams(location.search),oobCode=query.get('oobCode'),action=query.get('mode');
   if(oobCode){history.replaceState(null,'',location.pathname);if(['verifyEmail','verifyAndChangeEmail','recoverEmail'].includes(action)){await auth.confirmEmailVerification(oobCode);notice('Email action confirmed. Sign in to continue.',true);}
    else if(action==='resetPassword'){await step('Choose a new password',[{name:'password',label:'New password (12–128 characters)',type:'password',autocomplete:'new-password',min:12}],v=>auth.confirmPasswordReset(oobCode,v.password));notice('Password reset. Sign in with your new password.',true);}}
   await auth.restore();await loadDashboard();
  }catch(error){if(error.code!=='UI_CANCELLED')notice(error.message);}
 }
 init();if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}),{once:true});
})();
