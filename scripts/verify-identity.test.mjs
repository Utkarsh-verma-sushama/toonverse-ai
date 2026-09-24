import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseAuthenticator } from '../backend/firebase-auth.mjs';
import { env, seconds, jwk, claims, token, request, mockIdentity } from './security-fixtures.mjs';

const denied = error => error.status === 401 && error.code === 'UNAUTHORIZED';
const unavailable = error => error.status === 503;

test('valid signed token uses the verified UID and current account state', async () => {
  const mock = mockIdentity(); const auth = createFirebaseAuthenticator(mock);
  assert.deepEqual(await auth(request(await token()), env), {sub:'alice', verified:true, emailVerified:true});
  assert.equal(mock.calls.lookup, 1);
});
for (const [name, changes] of Object.entries({
  'missing expiry':{exp:undefined}, 'null expiry':{exp:null}, 'string expiry':{exp:'9999999999'},
  'expired':{exp:seconds()-1}, 'missing issued-at':{iat:undefined}, 'future issued-at':{iat:seconds()+300},
  'missing auth time':{auth_time:undefined}, 'future auth time':{auth_time:seconds()+300},
  'auth time after issue':{auth_time:seconds()-1}, 'wrong audience':{aud:'another-project'},
  'wrong issuer':{iss:'https://attacker.invalid'}, 'empty subject':{sub:''}, 'long subject':{sub:'a'.repeat(129)},
  'non-string subject':{sub:42}, 'foreign tenant':{firebase:{tenant:'other'}}, 'negative issue time':{iat:-1}
})) test(`rejects ${name} before key or account lookup`, async () => {
  const mock=mockIdentity();const auth=createFirebaseAuthenticator(mock);
  await assert.rejects(auth(request(await token(claims(changes))),env),denied);
  assert.deepEqual(mock.calls,{keys:0,lookup:0});
});
for (const [name,header] of Object.entries({'none algorithm':{alg:'none',kid:jwk.kid}, 'HMAC algorithm':{alg:'HS256',kid:jwk.kid}, 'missing key ID':{alg:'RS256'}, 'critical extension':{alg:'RS256',kid:jwk.kid,crit:['bad']}})) test(`rejects ${name}`,async()=>{
  await assert.rejects(createFirebaseAuthenticator(mockIdentity())(request(await token(claims(),header)),env),denied);
});
test('rejects tampered signature before account lookup', async()=>{
  const mock=mockIdentity();const value=await token();const parts=value.split('.');
  parts[1]=Buffer.from(JSON.stringify(claims({sub:'victim'}))).toString('base64url');
  await assert.rejects(createFirebaseAuthenticator(mock)(request(parts.join('.')),env),denied);
  assert.equal(mock.calls.lookup,0);
});
test('missing environment and AUTH_REQUIRED=false cannot grant a development identity',async()=>{
  const auth=createFirebaseAuthenticator(mockIdentity());
  await assert.rejects(auth(new Request('https://example.invalid'),{AUTH_REQUIRED:'false'}),denied);
  await assert.rejects(auth(request(await token()),{}),unavailable);
  await assert.rejects(auth(request(await token()),{FIREBASE_PROJECT_ID:env.FIREBASE_PROJECT_ID}),unavailable);
});
for(const value of ['x.y.z','a.b','a.b.c.d','x'.repeat(17000)])test(`rejects malformed token (${value.length} bytes)`,async()=>{
  await assert.rejects(createFirebaseAuthenticator(mockIdentity())(request(value),env),denied);
});
for(const [name,account] of Object.entries({'disabled account':{disabled:true},'wrong returned UID':{localId:'bob'},'revoked session':{validSince:String(seconds()-50)},'missing revocation boundary':{validSince:undefined},'malformed revocation boundary':{validSince:'NaN'}}))test(`rejects ${name}`,async()=>{
  await assert.rejects(createFirebaseAuthenticator(mockIdentity({account}))(request(await token()),env),denied);
});
for(const code of ['USER_NOT_FOUND','USER_DISABLED','INVALID_ID_TOKEN','TOKEN_EXPIRED'])test(`rejects Firebase ${code}`,async()=>{
  await assert.rejects(createFirebaseAuthenticator(mockIdentity({lookupStatus:400,lookupError:code}))(request(await token()),env),denied);
});
test('key server and account lookup outages fail closed with 503',async()=>{
  for(const mock of [mockIdentity({keyStatus:503}),mockIdentity({lookupStatus:503,lookupError:'UNAVAILABLE'}),{fetch:async()=>{throw new Error('network');}}]){
    await assert.rejects(createFirebaseAuthenticator(mock)(request(await token()),env),unavailable);
  }
});
test('concurrent valid requests share a key fetch but independently check revocation',async()=>{
  const mock=mockIdentity();const auth=createFirebaseAuthenticator(mock);const value=await token();
  await Promise.all(Array.from({length:20},()=>auth(request(value),env)));
  assert.equal(mock.calls.keys,1);assert.equal(mock.calls.lookup,20);
});
test('unknown key IDs cannot force repeated key downloads',async()=>{
  const mock=mockIdentity();const auth=createFirebaseAuthenticator(mock);
  await auth(request(await token()),env);
  for(let i=0;i<10;i++)await assert.rejects(auth(request(await token(claims(),{alg:'RS256',kid:`attacker-${i}`})),env),denied);
  assert.equal(mock.calls.keys,1);
});
test('expired keys are not reused when refresh fails',async()=>{
  const mock=mockIdentity({cacheControl:'max-age=1'});let clock=Date.now();let outage=false;
  const auth=createFirebaseAuthenticator({now:()=>clock,fetch:(...args)=>outage?Promise.reject(new Error('offline')):mock.fetch(...args)});
  const value=await token();await auth(request(value),env);clock+=31000;outage=true;
  await assert.rejects(auth(request(value),env),unavailable);
});
