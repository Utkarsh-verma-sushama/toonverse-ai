import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../backend/worker.mjs';
import {accountDatabase,accountEnv,accountHeaders,identityService,device} from './account-fixtures.mjs';
import {hash,decrypt} from '../backend/account-common.mjs';
const originalFetch=globalThis.fetch;let db,provider,jar,access;
beforeEach(async()=>{db=accountDatabase();provider=await identityService();globalThis.fetch=provider.fetch;jar='';access='';});
afterEach(()=>{globalThis.fetch=originalFetch;db.sql.close();});
async function call(path,{method='POST',body={},headers={},value=access,cookie=jar,bindings={}}={}){
 const h={...accountHeaders,...(cookie?{cookie}:{}),...(value?{authorization:'Bearer '+value}:{}),...headers};
 for(const k of Object.keys(h))if(h[k]===null)delete h[k];
 const response=await worker.fetch(new Request('https://api.uvenaro.invalid'+path,{method,headers:h,...(method==='POST'?{body:JSON.stringify(body)}:{})}),{...accountEnv,...db,...bindings});
 if(response.headers.has('set-cookie'))jar=response.headers.get('set-cookie').split(';')[0];
 return {response,body:await response.json()};
}
async function login(uid='alice',options={}){const out=await call('/v1/auth/sign-in',{body:{email:uid+'@example.com',password:'test-password-123'},value:'',...options});assert.equal(out.response.status,200,JSON.stringify(out.body));access=out.body.accessToken;return out;}
test('registration issues only an opaque access token and secure host-only refresh cookie',async()=>{
 const {response,body}=await call('/v1/auth/register',{body:{name:'Alice',email:' Alice@example.com ',password:'correct horse battery staple'}});
 assert.equal(response.status,200,JSON.stringify(body));assert.match(body.accessToken,/^uv1\./);assert.equal(body.user.id,'alice');assert.equal(body.user.name,'Alice');
 assert.match(response.headers.get('set-cookie'),/^__Host-uvenaro-session=.+; Path=\/; HttpOnly; Secure; SameSite=Lax;/);
 assert.equal(body.refreshToken,undefined);assert.equal(body.idToken,undefined);assert.equal(body.user.plan,'free');
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM billing_accounts').get().n,0);
 const row=db.sql.prepare('SELECT * FROM account_sessions').get();assert.ok(!row.credentials_cipher.includes('refresh-alice'));
 assert.equal((await decrypt(accountEnv,row.credentials_cipher,`session:${row.id}:alice`)).refreshToken,'refresh-alice');
 assert.ok(!JSON.stringify(db.sql.prepare('SELECT * FROM account_security_events').all()).includes('password'));
});
test('login uses Firebase UID; client owner, role and paid-plan fields cannot elevate privileges',async()=>{
 const out=await login('alice',{body:{email:'alice@example.com',password:'test-password',owner:'bob',plan:'premium',emailVerified:true}});
 assert.equal(out.body.user.id,'alice');assert.equal(out.body.user.plan,'free');assert.deepEqual(out.body.user.entitlements,[]);
});
test('Firebase JWT alone cannot bypass application session revocation',async()=>{
 const jwt=(await provider.make()).idToken;
 const out=await call('/v1/account/profile',{method:'GET',value:jwt});assert.equal(out.response.status,401);
 const chat=await call('/v1/chat/requests/key',{method:'GET',value:jwt});assert.equal(chat.response.status,401);
});
for(const [label,headers] of [
 ['missing origin',{origin:null}],['hostile origin',{origin:'https://evil.invalid'}],['null origin',{origin:'null'}],
 ['missing CSRF header',{'x-uvenaro-csrf':null}],['missing device',{'x-uvenaro-device':null}]
])test(`${label} cannot start a login or recovery request`,async()=>{
 for(const path of ['/v1/auth/sign-in','/v1/auth/password/reset/request']){const out=await call(path,{headers,body:{email:'alice@example.com',password:'test-password'}});assert.ok([400,403].includes(out.response.status));}
 assert.equal(provider.providerCalls,0);
});
test('account activation and encrypted-session secret are mandatory',async()=>{
 for(const bindings of [{ACCOUNT_AUTH_ENABLED:'false'},{ACCOUNT_SESSION_KEY:''},{DB:undefined}]){const out=await call('/v1/auth/sign-in',{body:{email:'alice@example.com',password:'test-password'},bindings});assert.equal(out.response.status,503);}
 assert.equal(provider.providerCalls,0);
});
test('refresh rotates the cookie, keeps UID, and never exposes Firebase credentials',async()=>{
 await login();const before=jar;const out=await call('/v1/auth/refresh',{value:''});assert.equal(out.response.status,200,JSON.stringify(out.body));assert.notEqual(jar,before);assert.notEqual(out.body.accessToken,access);assert.equal(out.body.user.id,'alice');
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM account_refresh_tokens WHERE consumed_at IS NOT NULL').get().n,1);
});
test('parallel refresh claims one provider exchange and yields a retryable conflict',async()=>{
 await login();const old=jar,prior=provider.providerCalls;
 const outcomes=await Promise.all(Array.from({length:8},()=>call('/v1/auth/refresh',{value:'',cookie:old})));
 assert.equal(outcomes.filter(x=>x.response.status===200).length,1);assert.ok(outcomes.filter(x=>x.response.status!==200).every(x=>x.body.code==='SESSION_REFRESH_BUSY'));
 assert.equal(provider.providerCalls-prior,1);
});
test('old refresh token reuse revokes the family and all its access tokens',async()=>{
 await login();const old=jar;await call('/v1/auth/refresh',{value:''});db.sql.exec('UPDATE account_refresh_tokens SET consumed_at=consumed_at-20000 WHERE consumed_at IS NOT NULL');
 const replay=await call('/v1/auth/refresh',{cookie:old,value:''});assert.equal(replay.response.status,401);
 assert.equal((await call('/v1/account/profile',{method:'GET'})).response.status,401);
 assert.equal(db.sql.prepare('SELECT credentials_cipher FROM account_sessions').get().credentials_cipher,null);
});
test('cookie from a different device or origin cannot restore a session',async()=>{
 await login();const before=provider.providerCalls;
 const out=await call('/v1/auth/refresh',{value:'',headers:{'x-uvenaro-device':'other-device-000000000000'}});assert.equal(out.response.status,401);assert.equal(provider.providerCalls,before);
 const other=await call('/v1/auth/refresh',{value:'',headers:{origin:'https://www.uvenaro.com'},bindings:{ALLOWED_ORIGINS:'https://uvenaro.com,https://www.uvenaro.com'}});assert.equal(other.response.status,401);
});
test('duplicate session cookie names fail closed',async()=>{
 await login();assert.equal((await call('/v1/auth/refresh',{value:'',cookie:jar+'; '+jar})).response.status,401);
});
test('current logout immediately invalidates access and refresh tokens',async()=>{
 await login();const old=jar;assert.equal((await call('/v1/auth/sign-out')).response.status,200);
 assert.match(jar,/=$/);assert.equal((await call('/v1/account/profile',{method:'GET'})).response.status,401);
 assert.equal((await call('/v1/auth/refresh',{cookie:old,value:''})).response.status,401);
});
test('logout still revokes the cookie session after access expiry',async()=>{
 await login();db.sql.exec('UPDATE account_access_tokens SET expires_at=0');assert.equal((await call('/v1/auth/sign-out')).response.status,200);
 assert.ok(db.sql.prepare('SELECT revoked_at FROM account_sessions').get().revoked_at);
});
test('owner can revoke another device without revoking their current one',async()=>{
 await login();const first=access;await login();const second=access;
 const list=await call('/v1/auth/sessions',{method:'GET'});assert.equal(list.body.sessions.length,2);
 const other=list.body.sessions.find(s=>!s.current);assert.equal((await call('/v1/auth/sessions/'+other.id,{method:'DELETE'})).response.status,200);
 assert.equal((await call('/v1/account/profile',{method:'GET',value:first})).response.status,401);
 assert.equal((await call('/v1/account/profile',{method:'GET',value:second})).response.status,200);
});
test('another account cannot list or revoke private sessions or events',async()=>{
 await login();const aliceSession=db.sql.prepare('SELECT id FROM account_sessions').get().id;await login('bob');
 assert.equal((await call('/v1/auth/sessions/'+aliceSession,{method:'DELETE'})).response.status,404);
 const list=await call('/v1/auth/sessions',{method:'GET'});assert.equal(list.body.sessions.length,1);
 assert.ok(!JSON.stringify((await call('/v1/auth/security/events',{method:'GET'})).body).includes(aliceSession));
});
test('sign out all other sessions retains only the caller',async()=>{
 await login();const old=access;await login();assert.equal((await call('/v1/auth/sessions/revoke-others')).response.status,200);
 assert.equal((await call('/v1/account/profile',{method:'GET',value:old})).response.status,401);assert.equal((await call('/v1/account/profile',{method:'GET'})).response.status,200);
});
test('password recovery has identical public result for missing and existing accounts',async()=>{
 const first=await call('/v1/auth/password/reset/request',{body:{email:'alice@example.com'}});
 provider.failure='EMAIL_NOT_FOUND';const second=await call('/v1/auth/password/reset/request',{body:{email:'missing@example.com'}});
 assert.equal(first.response.status,200);assert.equal(second.response.status,200);assert.deepEqual(first.body,second.body);
});
test('password reset completion revokes every existing managed session',async()=>{
 await login();const out=await call('/v1/auth/password/reset/confirm',{body:{oobCode:'valid-reset-code',newPassword:'long enough new password'},value:''});
 assert.equal(out.response.status,200);assert.equal((await call('/v1/account/profile',{method:'GET'})).response.status,401);
});
test('expired reset link and short new password fail without reporting success',async()=>{
 provider.failure='EXPIRED_OOB_CODE';assert.equal((await call('/v1/auth/password/reset/confirm',{body:{oobCode:'expired-code-123',newPassword:'long enough password'}})).body.code,'INVALID_ACTION_CODE');
 const count=provider.providerCalls;assert.equal((await call('/v1/auth/register',{body:{name:'Alice',email:'alice@example.com',password:'short'}})).body.code,'PASSWORD_POLICY');assert.equal(provider.providerCalls,count);
});
test('sensitive profile export, deletion and password change require recent authentication',async()=>{
 await login();db.sql.exec('UPDATE account_sessions SET authenticated_at=0');
 for(const [path,body] of [['/v1/account/export',{}],['/v1/account/deletion/request',{confirmation:'DELETE'}],['/v1/auth/password/change',{newPassword:'long enough password'}]])assert.equal((await call(path,{body})).body.code,'RECENT_AUTH_REQUIRED');
 const out=await call('/v1/auth/reauthenticate',{body:{password:'correct password'}});assert.equal(out.response.status,200,JSON.stringify(out.body));
 assert.equal((await call('/v1/account/export')).response.status,200);
});
test('profile updates only allow display preferences, never UID, email, role or billing',async()=>{
 await login();const out=await call('/v1/account/profile',{body:{name:'New name',locale:'hi',timezone:'Asia/Kolkata',email:'bob@example.com',id:'bob',plan:'premium',status:'admin'}});
 assert.equal(out.response.status,200);assert.equal(out.body.user.name,'New name');assert.equal(out.body.user.id,'alice');assert.equal(out.body.user.email,'alice@example.com');assert.equal(out.body.user.plan,'free');
});
test('export is owner scoped, paginated and excludes session credentials and token hashes',async()=>{
 await login();for(let i=0;i<102;i++)db.sql.prepare('INSERT INTO account_security_events VALUES (?,?,?,?,?)').run('event-'+String(i).padStart(3,'0'),'alice',null,'test',Date.now());
 db.sql.prepare('INSERT INTO account_security_events VALUES (?,?,?,?,?)').run('bob-secret','bob',null,'private',Date.now());
 const first=await call('/v1/account/export');assert.equal(first.response.status,200);assert.equal(first.body.records.length,100);assert.ok(first.body.nextCursor);
 const next=await call('/v1/account/export',{body:{resource:'security',cursor:first.body.nextCursor}});assert.equal(next.body.nextCursor,null);assert.ok(next.body.records.length>=2);
 const sessions=await call('/v1/account/export',{body:{resource:'sessions'}});assert.ok(!JSON.stringify(sessions.body).includes('credentials_cipher'));assert.ok(!JSON.stringify(first.body).includes('bob-secret'));
});
test('deletion request records pending review, blocks creative execution, and can be cancelled',async()=>{
 await login();assert.equal((await call('/v1/account/deletion/request',{body:{confirmation:'DELETE'}})).response.status,202);
 assert.equal((await call('/v1/account/deletion',{method:'GET'})).body.request.status,'pending_review');
 assert.equal((await call('/v1/chat/requests/key',{method:'GET'})).body.code,'ACCOUNT_RESTRICTED');
 assert.equal((await call('/v1/account/deletion/cancel')).response.status,200);
 assert.equal((await call('/v1/account/profile',{method:'GET'})).body.user.status,'active');
});
test('rate limits are atomic across concurrent login attempts and suppress provider calls',async()=>{
 provider.failure='INVALID_LOGIN_CREDENTIALS';const outcomes=await Promise.all(Array.from({length:20},()=>call('/v1/auth/sign-in',{body:{email:'alice@example.com',password:'wrong'}})));
 assert.equal(outcomes.filter(x=>x.response.status===429).length,10);assert.equal(provider.providerCalls,10);
 assert.ok(!JSON.stringify(db.sql.prepare('SELECT * FROM account_rate_limits').all()).includes('alice@example.com'));
});
test('MFA first factor cannot create a session or reveal the provider pending credential',async()=>{
 provider.mfa=true;const out=await call('/v1/auth/sign-in',{body:{email:'alice@example.com',password:'correct'}});
 assert.equal(out.body.code,'MFA_REQUIRED');assert.ok(out.body.challengeId);assert.ok(!JSON.stringify(out.body).includes('private-mfa-proof'));
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM account_sessions').get().n,0);
 const complete=await call('/v1/auth/mfa/challenge',{body:{challengeId:out.body.challengeId,methodId:'totp-1',code:'123456'}});assert.equal(complete.response.status,200,JSON.stringify(complete.body));
 const replay=await call('/v1/auth/mfa/challenge',{body:{challengeId:out.body.challengeId,methodId:'totp-1',code:'123456'}});assert.equal(replay.response.status,401);
});
test('MFA challenge is device bound and stops after five wrong codes',async()=>{
 provider.mfa=true;const out=await call('/v1/auth/sign-in',{body:{email:'alice@example.com',password:'correct'}});const body={challengeId:out.body.challengeId,methodId:'totp-1',code:'000000'};
 assert.equal((await call('/v1/auth/mfa/challenge',{body,headers:{'x-uvenaro-device':'other-device-00000000'}})).body.code,'INVALID_CHALLENGE');
 for(let i=0;i<5;i++)assert.equal((await call('/v1/auth/mfa/challenge',{body})).response.status,401);
 assert.equal((await call('/v1/auth/mfa/challenge',{body:{...body,code:'123456'}})).body.code,'INVALID_CHALLENGE');
});
test('new authenticated MFA challenge supersedes the previous live challenge',async()=>{
 await login();provider.mfa=true;
 await call('/v1/auth/reauthenticate',{body:{password:'correct'}});
 const first=db.sql.prepare("SELECT id FROM account_challenges WHERE owner_id='alice' AND kind='reauth_mfa' AND consumed_at IS NULL ORDER BY expires_at DESC LIMIT 1").get();
 assert.ok(first?.id);
 await call('/v1/auth/reauthenticate',{body:{password:'correct'}});
 const rows=db.sql.prepare("SELECT id,consumed_at FROM account_challenges WHERE owner_id='alice' AND kind='reauth_mfa' ORDER BY rowid").all();
 assert.equal(rows.length,2);assert.ok(rows[0].consumed_at);assert.equal(rows[1].consumed_at,null);assert.notEqual(rows[0].id,rows[1].id);
});
test('exhausted MFA challenge destroys its encrypted payload',async()=>{
 provider.mfa=true;const out=await call('/v1/auth/sign-in',{body:{email:'alice@example.com',password:'correct'}});
 const body={challengeId:out.body.challengeId,methodId:'totp-1',code:'000000'};
 for(let i=0;i<5;i++)assert.equal((await call('/v1/auth/mfa/challenge',{body})).response.status,401);
 const row=db.sql.prepare('SELECT consumed_at,payload_cipher FROM account_challenges WHERE id=?').get(out.body.challengeId);
 assert.ok(row.consumed_at);assert.equal(row.payload_cipher,'attempts_exhausted');
});
test('TOTP enrollment requires proof of a working code and revokes existing sessions',async()=>{
 await login();const start=await call('/v1/auth/mfa/totp/enroll');assert.equal(start.response.status,200,JSON.stringify(start.body));assert.match(start.body.uri,/^otpauth:/);
 assert.ok(!db.sql.prepare('SELECT payload_cipher FROM account_challenges').get().payload_cipher.includes('enroll-secret'));
 const finish=await call('/v1/auth/mfa/totp/confirm',{body:{challengeId:start.body.challengeId,code:'123456'}});assert.equal(finish.response.status,200,JSON.stringify(finish.body));assert.equal(finish.body.signInRequired,true);
 assert.equal((await call('/v1/account/profile',{method:'GET'})).response.status,401);
});
test('unsupported methods are never advertised as ready',async()=>{
 const out=await call('/v1/auth/capabilities',{method:'GET'});assert.deepEqual(out.body.providers,[]);assert.equal(out.body.passkeys,false);assert.equal(out.body.phoneOtp,false);
});
test('session encryption tampering, idle expiry and account database outage fail closed',async()=>{
 await login();db.sql.exec("UPDATE account_sessions SET credentials_cipher='corrupt'");assert.equal((await call('/v1/account/profile',{method:'GET'})).response.status,503);
 await login();db.sql.exec('UPDATE account_sessions SET idle_expires_at=0');assert.equal((await call('/v1/account/profile',{method:'GET'})).response.status,401);
 const out=await call('/v1/auth/capabilities',{method:'GET',bindings:{DB:undefined}});assert.equal(out.response.status,503);
});
test('ledger failure prevents partially committed new account sessions',async()=>{
 db.sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON account_security_events BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 const out=await call('/v1/auth/sign-in',{body:{email:'alice@example.com',password:'test password'}});assert.equal(out.response.status,503);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM account_sessions').get().n,0);assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM account_profiles').get().n,0);
});

test('only same-origin GET may infer Origin from browser fetch metadata',async()=>{
 const bindings={ALLOWED_ORIGINS:'https://api.uvenaro.invalid'},headers={origin:null,'sec-fetch-site':'same-origin'};
 assert.equal((await call('/v1/auth/capabilities',{method:'GET',headers,bindings})).response.status,200);
 assert.equal((await call('/v1/auth/capabilities',{method:'GET',headers:{...headers,'sec-fetch-site':'cross-site'},bindings})).response.status,403);
 assert.equal((await call('/v1/auth/sign-in',{headers,bindings,body:{email:'alice@example.com',password:'test password'}})).response.status,403);
});
test('a crashed refresh lease expires and revokes credentials instead of blocking forever',async()=>{
 await login();db.sql.prepare('UPDATE account_sessions SET refresh_lock=?,refresh_started_at=?').run('abandoned',Date.now()-121000);
 const out=await call('/v1/auth/refresh',{value:''});assert.equal(out.body.code,'SESSION_EXPIRED');assert.equal(db.sql.prepare('SELECT credentials_cipher FROM account_sessions').get().credentials_cipher,null);
});
test('password change cannot reach Firebase when durable session revocation fails',async()=>{
 await login();db.sql.exec("CREATE TRIGGER fail_revoke BEFORE UPDATE ON account_sessions BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 const count=provider.providerCalls;const out=await call('/v1/auth/password/change',{body:{newPassword:'a different long password'}});
 assert.equal(out.response.status,503);assert.equal(provider.providerCalls,count);
});
test('password reset verifies the link then stops before changing credentials if revocation fails',async()=>{
 await login();db.sql.exec("CREATE TRIGGER fail_revoke BEFORE UPDATE ON account_sessions BEGIN SELECT RAISE(ABORT,'test failure'); END;");
 const out=await call('/v1/auth/password/reset/confirm',{value:'',body:{oobCode:'valid-reset-code',newPassword:'a different long password'}});
 assert.equal(out.response.status,503);assert.equal(provider.calls.at(-1).input.newPassword,undefined);
});
test('email changes require recent proof and a verified change link without rewriting identity',async()=>{
 await login();db.sql.exec('UPDATE account_sessions SET authenticated_at=0');
 assert.equal((await call('/v1/auth/email/change/request',{body:{email:'new@example.com'}})).body.code,'RECENT_AUTH_REQUIRED');
 await call('/v1/auth/reauthenticate',{body:{password:'correct password'}});
 assert.equal((await call('/v1/auth/email/change/request',{body:{email:'new@example.com'}})).response.status,200);
 assert.equal(provider.calls.at(-1).input.requestType,'VERIFY_AND_CHANGE_EMAIL');assert.equal(provider.calls.at(-1).input.newEmail,'new@example.com');
 assert.equal(db.sql.prepare('SELECT email FROM account_profiles').get().email,'alice@example.com');
});
test('export includes owner joined agent steps and excludes another owner records',async()=>{
 await login();for(const owner of ['alice','bob']){
  db.sql.prepare('INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?,?,?)').run(owner+'-run',owner,'queued','objective','{}',null,'2026-09-24','2026-09-24',owner+'-key');
  db.sql.prepare('INSERT INTO agent_steps VALUES (?,?,?,?,?,?,?,?,?,?)').run(owner+'-step',owner+'-run',1,'tool','queued',null,null,0,null,null);
 }
 const out=await call('/v1/account/export',{body:{resource:'steps'}});assert.equal(out.response.status,200);assert.deepEqual(out.body.records.map(x=>x.id),['alice-step']);
 for(const resource of ['billingAccount','limits','approvals'])assert.equal((await call('/v1/account/export',{body:{resource}})).response.status,200);
});
test('provider configuration failure returns unavailable instead of blaming user credentials',async()=>{
 provider.failure='OPERATION_NOT_ALLOWED';const out=await call('/v1/auth/sign-in',{body:{email:'alice@example.com',password:'test password'}});assert.equal(out.response.status,503);assert.equal(out.body.code,'ACCOUNT_NOT_CONFIGURED');
});
