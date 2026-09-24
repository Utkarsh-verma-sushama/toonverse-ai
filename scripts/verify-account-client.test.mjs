import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/auth.js',import.meta.url),'utf8');
const session=(id='alice')=>({accessToken:'uv1.'+'a'.repeat(43),expiresAt:Date.now()+300000,user:{id,name:id,email:id+'@example.com',entitlements:[]}});
function app({fetch=async()=>Response.json(session()),enabled=true,data=new Map(),locks}={}){
 const handlers={};const window={UvenaroConfig:{features:{authentication:enabled},services:{apiBaseUrl:'https://uvenaro.com/api'}},addEventListener(name,fn){handlers[name]=fn;},dispatchEvent(){}};
 const context={window,location:{href:'https://uvenaro.com/account.html'},navigator:{locks},localStorage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)},fetch,crypto,URL,Headers,AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(name,props){this.name=name;this.detail=props.detail;}},console};
 vm.runInNewContext(source,context);return {auth:window.UvenaroAuth,data,handlers,window};
}
test('authentication feature off prevents login, refresh and recovery network requests',async()=>{
 let calls=0;const a=app({enabled:false,fetch:async()=>{calls++;return Response.json(session());}});
 await a.auth.restore();await assert.rejects(a.auth.signInWithEmail('alice@example.com','password'),e=>e.code==='ACCOUNT_SERVICE_DISABLED');
 await assert.rejects(a.auth.requestPasswordReset('alice@example.com'));assert.equal(calls,0);
});
test('successful login keeps credentials in memory and sends anti-CSRF/device headers',async()=>{
 let options;const a=app({fetch:async(url,opts)=>{options=opts;return Response.json(session());}});await a.auth.signInWithEmail('alice@example.com','private-password');
 assert.equal(a.auth.getState().user.id,'alice');assert.equal(options.headers['x-uvenaro-csrf'],'1');assert.match(options.headers['x-uvenaro-device'],/^[a-z0-9-]{36}$/);assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');
 const saved=JSON.stringify([...a.data]);assert.ok(!saved.includes('private-password'));assert.ok(!saved.includes('uv1.'));assert.ok(!saved.includes('alice@example.com'));
});
test('overlapping login clicks execute only one identity request',async()=>{
 let finish,calls=0;const a=app({fetch:async()=>{calls++;return new Promise(r=>finish=r);}});const first=a.auth.signInWithEmail('alice@example.com','password');
 await assert.rejects(a.auth.signInWithEmail('alice@example.com','password'));finish(Response.json(session()));await first;assert.equal(calls,1);
});
test('concurrent refresh requests coalesce and use a browser lock when available',async()=>{
 let calls=0,lockCalls=0;const a=app({fetch:async()=>{calls++;return Response.json(session());},locks:{async request(name,fn){assert.equal(name,'uvenaro-auth-refresh');lockCalls++;return fn();}}});
 const tokens=await Promise.all(Array.from({length:12},()=>a.auth.getAccessToken()));assert.ok(tokens.every(t=>t===session().accessToken));assert.equal(calls,1);assert.equal(lockCalls,1);
});
test('late login response after logout is rejected and its new server session is revoked',async()=>{
 let finish;const paths=[];const a=app({fetch:async(url,opts)=>{paths.push({url,opts});if(url.endsWith('/sign-in'))return new Promise(r=>finish=r);return Response.json({ok:true});}});
 const login=a.auth.signInWithEmail('alice@example.com','password');await a.auth.signOut();finish(Response.json(session()));await assert.rejects(login,e=>e.code==='AUTH_CANCELLED');
 assert.equal(a.auth.getState().status,'signed-out');assert.equal(paths.filter(x=>x.url.endsWith('/sign-out')).length,2);
 assert.equal(paths.at(-1).opts.headers.authorization,'Bearer '+session().accessToken);
});
test('failed server logout is visible and prevents silent cookie restore',async()=>{
 let calls=0;const data=new Map(),a=app({data,fetch:async url=>{calls++;if(url.endsWith('/sign-out'))throw new Error('offline');return Response.json(session());}});
 await a.auth.signInWithEmail('alice@example.com','password');await assert.rejects(a.auth.signOut(),e=>e.code==='NETWORK_ERROR');assert.equal(a.auth.getState().status,'signed-out');
 await a.auth.restore();await assert.rejects(a.auth.getAccessToken());assert.equal(calls,2);
 const reloaded=app({data,fetch:async()=>{throw new Error('must not restore');}});await reloaded.auth.restore();assert.equal(reloaded.auth.getState().status,'signed-out');
});
test('a new explicit login can restore access after a local sign-out',async()=>{
 const a=app();await a.auth.signInWithEmail('alice@example.com','password');await a.auth.signOut();await a.auth.signInWithEmail('alice@example.com','password');assert.equal(await a.auth.getAccessToken(),session().accessToken);
});
test('logout broadcast clears the account visible in another tab',async()=>{
 const a=app();await a.auth.signInWithEmail('alice@example.com','password');a.handlers.storage({key:'uvenaro:auth:logout',newValue:'1'});assert.equal(a.auth.getState().user,null);await assert.rejects(a.auth.getAccessToken());
});
test('MFA challenge response cannot mark the first factor as signed in',async()=>{
 const a=app({fetch:async()=>Response.json({code:'MFA_REQUIRED',challengeId:'test-challenge',methods:[{id:'totp-1',name:'Authenticator'}]},{status:401})});
 await assert.rejects(a.auth.signInWithEmail('alice@example.com','password'),e=>e.code==='MFA_REQUIRED'&&e.challengeId==='test-challenge');assert.equal(a.auth.getState().status,'mfa-required');assert.equal(a.auth.getState().user,null);
});
test('malformed session responses and expired access tokens are never accepted',async()=>{
 for(const payload of [{...session(),accessToken:'firebase-id-token'},{...session(),user:{}},{...session(),expiresAt:0}]){const a=app({fetch:async()=>Response.json(payload)});await assert.rejects(a.auth.signInWithEmail('alice@example.com','password'));assert.equal(a.auth.getState().user,null);}
});
test('expired server session clears the account; temporary failures preserve identity state',async()=>{
 const a=app({fetch:async()=>Response.json({code:'SESSION_EXPIRED'},{status:401})});await a.auth.restore();assert.equal(a.auth.getState().status,'signed-out');
 const b=app({fetch:async()=>Response.json({code:'IDENTITY_UNAVAILABLE'},{status:503})});await b.auth.restore();assert.equal(b.auth.getState().lastError,'IDENTITY_UNAVAILABLE');
});
test('sign out all requires recent authentication before clearing local access',async()=>{
 const a=app({fetch:async url=>url.endsWith('/security')?Response.json({recentAuthentication:false}):Response.json(session())});await a.auth.signInWithEmail('alice@example.com','password');
 await assert.rejects(a.auth.signOut({allDevices:true}),e=>e.code==='RECENT_AUTH_REQUIRED');assert.equal(a.auth.getState().status,'signed-in');
});
test('unsupported provider and passkey methods do not navigate or contact a fake endpoint',async()=>{
 let calls=0;const a=app({fetch:async()=>{calls++;return Response.json({});}});for(const name of ['beginProvider','beginPasskey','sendOtp','rotateRecoveryCodes'])await assert.rejects(a.auth[name]('google'),e=>e.code==='ACCOUNT_METHOD_UNAVAILABLE');assert.equal(calls,0);
});
test('client snapshots do not let callers mutate internal account entitlements',async()=>{
 const a=app();await a.auth.signInWithEmail('alice@example.com','password');const snapshot=a.auth.getState();snapshot.user.id='bob';snapshot.user.entitlements.push('premium');assert.equal(a.auth.getState().user.id,'alice');assert.equal(a.auth.getState().user.entitlements.length,0);
});

test('revoked protected requests immediately clear the visible account',async()=>{
 const a=app({fetch:async url=>url.endsWith('/sign-in')?Response.json(session()):Response.json({code:'SESSION_EXPIRED'},{status:401})});
 await a.auth.signInWithEmail('alice@example.com','password');await assert.rejects(a.auth.getProfile());assert.equal(a.auth.getState().status,'signed-out');assert.equal(a.auth.getState().user,null);
});
