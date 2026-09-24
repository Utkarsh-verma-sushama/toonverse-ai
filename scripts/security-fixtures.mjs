import { webcrypto } from 'node:crypto';
export const project = 'demo-uvenaro-security';
export const env = { FIREBASE_PROJECT_ID: project, FIREBASE_WEB_API_KEY: 'test-only-key' };
export const seconds = () => Math.floor(Date.now() / 1000);
export const keyPair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
export const jwk = { ...await webcrypto.subtle.exportKey('jwk', keyPair.publicKey), kid: 'test-key', use: 'sig', alg: 'RS256' };
export function claims(overrides = {}) { return { aud: project, iss: `https://securetoken.google.com/${project}`, sub: 'alice', iat: seconds()-10, auth_time: seconds()-100, exp: seconds()+3600, ...overrides }; }
export async function token(payload = claims(), header = {alg: 'RS256', kid: jwk.kid}) {
  const data = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(data));
  return `${data}.${Buffer.from(signature).toString('base64url')}`;
}
export const request = value => new Request('https://api.example.invalid/v1/test', {headers: {Authorization: `Bearer ${value}`}});
export function mockIdentity({account = {}, keyStatus = 200, lookupStatus = 200, lookupError, cacheControl = 'max-age=3600', keys = [jwk]} = {}) {
  const calls = {keys: 0, lookup: 0};
  const fetch = async (url, options) => {
    if (url.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) { calls.keys++; return Response.json({keys}, {status: keyStatus, headers: {'cache-control':cacheControl}}); }
    if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?')) {
      calls.lookup++;
      const payload = JSON.parse(Buffer.from(JSON.parse(options.body).idToken.split('.')[1], 'base64url').toString());
      return Response.json(lookupError ? {error:{message:lookupError}} : {users:[{localId:payload.sub, validSince:'0', emailVerified:true, ...account}]}, {status:lookupStatus});
    }
    throw new Error(`Unexpected external request: ${new URL(url).hostname}`);
  };
  return {fetch, calls};
}
