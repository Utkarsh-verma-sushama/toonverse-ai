import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {firebaseCall,credentials,FirebaseAccountError} from '../backend/firebase-accounts.mjs';
const host=process.env.FIREBASE_AUTH_EMULATOR_HOST,project='demo-uvenaro-security';
if(!host||!/^127\.0\.0\.1:\d+$/.test(host)&&!/^localhost:\d+$/.test(host))throw new Error('Run through the local Firebase Auth emulator only.');
const env={FIREBASE_WEB_API_KEY:'fake-key',FIREBASE_PROJECT_ID:project};
const originalFetch=globalThis.fetch;let created;
before(()=>{globalThis.fetch=(url,options)=>{
 const u=new URL(url);if(!['identitytoolkit.googleapis.com','securetoken.googleapis.com'].includes(u.hostname))throw new Error('Non-emulator request blocked');
 return originalFetch(`http://${host}/${u.hostname}${u.pathname}${u.search}`,options);
};});
after(()=>{globalThis.fetch=originalFetch;});
async function codes(){const r=await originalFetch(`http://${host}/emulator/v1/projects/${project}/oobCodes`);assert.equal(r.status,200);return (await r.json()).oobCodes;}
test('real Auth emulator accepts signup and password sign-in through the production REST adapter',async()=>{
 created=await firebaseCall(env,'accounts:signUp',{email:'account-test@example.invalid',password:'a long test password',displayName:'Account test',returnSecureToken:true});
 assert.ok(credentials(created).refreshToken);assert.ok(created.localId);
 const signed=await firebaseCall(env,'accounts:signInWithPassword',{email:'account-test@example.invalid',password:'a long test password',returnSecureToken:true});assert.equal(signed.localId,created.localId);
});
test('real provider rejects incorrect password without returning credentials',async()=>{
 await assert.rejects(firebaseCall(env,'accounts:signInWithPassword',{email:'account-test@example.invalid',password:'wrong password',returnSecureToken:true}),e=>e instanceof FirebaseAccountError);
});
test('real refresh exchange preserves the same provider user',async()=>{
 const result=await firebaseCall(env,'',{grant_type:'refresh_token',refresh_token:created.refreshToken},{refresh:true});assert.equal(result.user_id,created.localId);assert.ok(credentials(result,{refresh:true}).idToken);
});
test('email verification is applied with a single-use emulator OOB code',async()=>{
 await firebaseCall(env,'accounts:sendOobCode',{requestType:'VERIFY_EMAIL',idToken:created.idToken});
 const code=(await codes()).find(x=>x.requestType==='VERIFY_EMAIL'&&x.email==='account-test@example.invalid').oobCode;
 const inspected=await firebaseCall(env,'accounts:resetPassword',{oobCode:code});assert.equal(inspected.requestType,'VERIFY_EMAIL');assert.equal(inspected.email,'account-test@example.invalid');
 await firebaseCall(env,'accounts:update',{oobCode:code});
 const lookup=await firebaseCall(env,'accounts:lookup',{idToken:created.idToken});assert.equal(lookup.users[0].emailVerified,true);
 await assert.rejects(firebaseCall(env,'accounts:update',{oobCode:code}),e=>e instanceof FirebaseAccountError);
});
test('password reset applies a real single-use action code and old password stops working',async()=>{
 await firebaseCall(env,'accounts:sendOobCode',{requestType:'PASSWORD_RESET',email:'account-test@example.invalid'});
 const code=(await codes()).find(x=>x.requestType==='PASSWORD_RESET'&&x.email==='account-test@example.invalid').oobCode;
 await firebaseCall(env,'accounts:resetPassword',{oobCode:code,newPassword:'a different long password'});
 await assert.rejects(firebaseCall(env,'accounts:signInWithPassword',{email:'account-test@example.invalid',password:'a long test password',returnSecureToken:true}));
 const signed=await firebaseCall(env,'accounts:signInWithPassword',{email:'account-test@example.invalid',password:'a different long password',returnSecureToken:true});assert.equal(signed.localId,created.localId);
 await assert.rejects(firebaseCall(env,'accounts:resetPassword',{oobCode:code,newPassword:'another long password'}));
});
