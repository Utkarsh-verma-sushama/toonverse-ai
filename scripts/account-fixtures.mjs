import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {schema,migration,d1} from './billing-fixtures.mjs';
import {env as identityEnv,token,claims,mockIdentity} from './security-fixtures.mjs';
import {hash,encrypt,keyedHash} from '../backend/account-common.mjs';
export const accountMigration=readFileSync(new URL('../backend/migrations/0002_account_sessions.sql',import.meta.url),'utf8');
export const accountEnv={...identityEnv,ACCOUNT_AUTH_ENABLED:'true',ACCOUNT_TOTP_ENABLED:'true',ACCOUNT_SESSION_KEY:Buffer.alloc(32,9).toString('base64url'),ALLOWED_ORIGINS:'https://uvenaro.com'};
export const device='test-device-00000000000001';
export const accountHeaders={origin:'https://uvenaro.com','x-uvenaro-csrf':'1','x-uvenaro-device':device,'content-type':'application/json','cf-connecting-ip':'192.0.2.10'};
export function accountDatabase(){const sql=new DatabaseSync(':memory:');sql.exec(schema);sql.exec(migration);sql.exec(accountMigration);return {sql,DB:d1(sql)};}
export function addAccountSchema(sql){if(!sql.prepare("SELECT name FROM sqlite_master WHERE name='account_profiles'").get())sql.exec(accountMigration);}
export async function seedManaged(sql,idToken,uid='alice'){
 addAccountSchema(sql);const env=accountEnv,id='fixture-'+uid,at=Date.now(),access='uv1.'+Buffer.from(uid.padEnd(32,'_')).toString('base64url');
 sql.prepare('INSERT OR IGNORE INTO account_profiles(owner_id,email,created_at,updated_at) VALUES (?,?,?,?)').run(uid,uid+'@example.com',at,at);
 if(!sql.prepare('SELECT id FROM account_sessions WHERE id=?').get(id)){
  sql.prepare(`INSERT INTO account_sessions (id,owner_id,origin,device_hash,device_name,credentials_cipher,created_at,last_active_at,authenticated_at,expires_at,idle_expires_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,uid,accountHeaders.origin,await keyedHash(env,'device:'+device),'Test device',await encrypt(env,{idToken,refreshToken:'fixture-refresh'},`session:${id}:${uid}`),at,at,at,at+86400000,at+86400000);
  sql.prepare('INSERT INTO account_access_tokens VALUES (?,?,?)').run(await hash(access),id,at+300000);
 }
 return access;
}
export async function identityService(){
 const records=new Map(),calls=[];let fail='',mfa=false,providerCalls=0;
 async function make(uid='alice',authTime=Math.floor(Date.now()/1000)){
  const value=await token(claims({sub:uid,auth_time:authTime,iat:Math.floor(Date.now()/1000)}));records.set(value,uid);return {idToken:value,refreshToken:'refresh-'+uid,localId:uid,email:uid+'@example.com',expiresIn:'3600'};
 }
 const mock=mockIdentity({account:{email:'alice@example.com',displayName:'Alice',providerUserInfo:[{providerId:'password'}]}});
 const fetch=async(url,options)=>{
  if(url.includes('/jwk/'))return mock.fetch(url,options);
  const body=String(options.body||''),input=options.headers['content-type']==='application/x-www-form-urlencoded'?Object.fromEntries(new URLSearchParams(body)):JSON.parse(body||'{}');
  if(url.includes('accounts:lookup')){
   const uid=JSON.parse(Buffer.from(input.idToken.split('.')[1],'base64url')).sub;
   return Response.json({users:[{localId:uid,email:uid+'@example.com',displayName:uid,emailVerified:true,validSince:'0',providerUserInfo:[{providerId:'password'}],...(mfa?{mfaInfo:[{mfaEnrollmentId:'totp-1',totpInfo:{}}]}:{})}]});
  }
  providerCalls++;calls.push({url,input});
  if(fail)return Response.json({error:{message:fail}},{status:400});
  if(url.includes('accounts:signInWithPassword')||url.includes('accounts:signUp')){
   if(mfa)return Response.json({mfaPendingCredential:'private-mfa-proof',mfaInfo:[{mfaEnrollmentId:'totp-1',displayName:'Test authenticator',totpInfo:{}}]});
   return Response.json(await make(input.email.split('@')[0]));
  }
  if(url.includes('securetoken.googleapis.com')){const r=await make(input.refresh_token.replace('refresh-',''));return Response.json({id_token:r.idToken,refresh_token:r.refreshToken,user_id:r.localId});}
  if(url.includes('mfaSignIn:finalize')){if(input.totpVerificationInfo.verificationCode!=='123456')return Response.json({error:{message:'INVALID_CODE'}},{status:400});return Response.json(await make());}
  if(url.includes('mfaEnrollment:start'))return Response.json({totpSessionInfo:{sharedSecretKey:'JBSWY3DPEHPK3PXP',verificationCodeLength:6,hashingAlgorithm:'SHA1',periodSec:30,sessionInfo:'enroll-secret'}});
  if(url.includes('mfaEnrollment:finalize')){mfa=true;return Response.json(await make());}
  if(url.includes('mfaEnrollment:withdraw')){mfa=false;return Response.json(await make());}
  if(url.includes('accounts:resetPassword'))return Response.json({email:'alice@example.com',requestType:'PASSWORD_RESET'});
  if(url.includes('accounts:sendOobCode')||url.includes('accounts:update'))return Response.json({email:'alice@example.com'});
  throw new Error('Unexpected identity test endpoint');
 };
 return {fetch,calls,make,get providerCalls(){return providerCalls;},set failure(value){fail=value;},set mfa(value){mfa=value;}};
}
