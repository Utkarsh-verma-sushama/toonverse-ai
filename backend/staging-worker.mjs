import worker from './worker.mjs';
import {configured} from './account-common.mjs';
import {cleanupAccounts} from './account-sessions.mjs';

export function stagingEnvironment(env,origin){
 let expected;
 try{expected=new URL(env.STAGING_ORIGIN);if(expected.protocol!=='https:'||expected.origin!==env.STAGING_ORIGIN||['uvenaro.com','www.uvenaro.com'].includes(expected.hostname))return null;}catch{return null;}
 if(env.ENVIRONMENT!=='staging'||origin!==expected.origin)return null;
 const emails=String(env.STAGING_ALLOWED_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(!emails.length||emails.length>20||emails.some(x=>x.length>254||!/^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/.test(x)))return null;
 return {...env,ALLOWED_ORIGINS:expected.origin,ACCOUNT_ALLOWED_EMAILS:emails.join(','),ACCOUNT_ACTION_CONTINUE_URL:expected.origin+'/account.html',ACCOUNT_TOTP_ENABLED:'false',
  CHAT_EXECUTION_ENABLED:'false',AGENT_EXECUTION_ENABLED:'false',MODEL_ROUTING_ENABLED:'false'};
}
async function ready(env){
 try{
  configured(env);
  await env.DB.prepare('SELECT credentials_cipher,refresh_started_at FROM account_sessions LIMIT 0').all();
  await env.DB.prepare('SELECT request_hash,provider_state FROM usage_reservations LIMIT 0').all();
  await env.DB.prepare('SELECT count FROM account_rate_limits LIMIT 0').all();
  return true;
 }catch{return false;}
}
function secured(response){
 const headers=new Headers(response.headers);
 headers.set('cache-control','no-store');headers.set('x-robots-tag','noindex, nofollow, noarchive');
 headers.set('x-content-type-options','nosniff');headers.set('x-frame-options','DENY');headers.set('referrer-policy','no-referrer');
 headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
 headers.set('strict-transport-security','max-age=31536000');
 if(headers.get('content-type')?.includes('text/html'))headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 return new Response(response.body,{status:response.status,headers});
}
const error=(code,status)=>secured(Response.json({code},{status}));
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url),safe=stagingEnvironment(env,url.origin);
  if(!safe)return error('STAGING_NOT_CONFIGURED',503);
  if(url.pathname==='/api/v1/health'&&request.method==='GET')return secured(Response.json({ok:true,service:'uvenaro-account-staging',accountReady:await ready(safe),providerChecked:false}));
  if(url.pathname.startsWith('/api/')){
   if(!/^\/api\/v1\/(?:auth|account)\//.test(url.pathname))return error('STAGING_ROUTE_UNAVAILABLE',404);
   url.pathname=url.pathname.slice(4);
   return secured(await worker.fetch(new Request(url,request),safe,ctx));
  }
  if(!['GET','HEAD'].includes(request.method))return error('METHOD_NOT_ALLOWED',405);
  if(url.pathname==='/sw.js')return error('STAGING_SERVICE_WORKER_DISABLED',410);
  if(url.pathname.startsWith('/v1/')||url.pathname.split('/').some(x=>x.startsWith('.')))return error('NOT_FOUND',404);
  if(!env.ASSETS)return error('STAGING_ASSETS_UNAVAILABLE',503);
  return secured(await env.ASSETS.fetch(request));
 },
 async scheduled(event,env,ctx){const safe=stagingEnvironment(env,env.STAGING_ORIGIN);if(safe)ctx.waitUntil(cleanupAccounts(safe));}
};
