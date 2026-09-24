// Read-only checks. Does not create accounts, send email, or change passwords.
const origin=process.env.UVENARO_STAGING_ORIGIN;
if(!origin||!/^https:\/\/uvenaro-account-staging\.[a-z0-9-]+\.workers\.dev$/.test(origin))throw new Error('Set the exact account staging workers.dev origin');
const device=crypto.randomUUID();
async function get(path,headers={}){return fetch(origin+path,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});}
const health=await get('/api/v1/health'),data=await health.json();
if(!health.ok||data.service!=='uvenaro-account-staging')throw new Error('Staging health endpoint failed');
const page=await get('/account.html');if(!page.ok||page.headers.get('referrer-policy')!=='no-referrer')throw new Error('Account page/security headers failed');
const caps=await get('/api/v1/auth/capabilities',{'origin':origin,'x-uvenaro-device':device,'x-uvenaro-csrf':'1'});
if(caps.status!==(data.accountReady?200:503))throw new Error('Capabilities do not match account readiness');
const denied=await get('/api/v1/auth/capabilities',{'origin':'https://untrusted.invalid','x-uvenaro-device':device,'x-uvenaro-csrf':'1'});
if(data.accountReady&&denied.status!==403)throw new Error('Untrusted origin was not rejected');
if((await get('/api/v1/chat/responses')).status!==404)throw new Error('Staging exposed a creative execution route');
console.log(JSON.stringify({transportChecked:true,accountReady:data.accountReady,realSignInChecked:false,emailDeliveryChecked:false}));
