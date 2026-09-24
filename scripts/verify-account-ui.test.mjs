import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {browser as launchBrowser} from './browser-fixtures.mjs';
import {accountDatabase,accountEnv,identityService} from './account-fixtures.mjs';
import worker from '../backend/worker.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),originalFetch=globalThis.fetch;let browser,ctx,page,db,provider,errors,enabled,server,origin,certDir,tls;
before(async()=>{certDir=await mkdtemp(resolve(tmpdir(),'uvenaro-tls-'));execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',resolve(certDir,'key.pem'),'-out',resolve(certDir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});tls={key:await readFile(resolve(certDir,'key.pem')),cert:await readFile(resolve(certDir,'cert.pem'))};browser=await launchBrowser();});
after(async()=>{await browser?.close();await rm(certDir,{recursive:true,force:true});});
beforeEach(async()=>{
 db=accountDatabase();provider=await identityService();globalThis.fetch=provider.fetch;enabled=true;errors=[];
 server=createServer(tls,async(req,res)=>{try{
  const url=new URL(req.url,origin);const send=(status,headers,body)=>{res.writeHead(status,headers);res.end(body);};
  if(url.pathname.startsWith('/api/v1/')){
   const headers={...req.headers,'cf-connecting-ip':'192.0.2.10'},chunks=[];for await(const c of req)chunks.push(c);const data=Buffer.concat(chunks);
   const response=await worker.fetch(new Request(url.href.replace('/api/v1/','/v1/'),{method:req.method,headers,...(data.length?{body:data}:{})}),{...accountEnv,...db,ALLOWED_ORIGINS:origin});
   const body=await response.text();if(response.status>=400&&process.env.UI_DEBUG)console.error('Account test response',url.pathname,response.status,JSON.parse(body).code,headers.origin,headers['sec-fetch-site']);
   return send(response.status,Object.fromEntries(response.headers),body);
  }
  const path=resolve(root,'.'+url.pathname);if(!path.startsWith(root))return send(403,{},'Forbidden');
  try{let body=await readFile(path);if(url.pathname==='/assets/js/config.js')body=Buffer.from(body.toString().replace('apiBaseUrl: ""','apiBaseUrl: "'+origin+'/api"').replace('authentication: false','authentication: '+enabled));
   return send(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(path)]||'application/octet-stream'},body);
  }catch{return send(404,{},'Not found');}
 }catch(error){errors.push(error.message);res.writeHead(500);res.end('Test server failure');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='https://127.0.0.1:'+server.address().port;
 ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',ignoreHTTPSErrors:true});page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
});
afterEach(async()=>{await ctx.close();await new Promise(r=>server.close(r));globalThis.fetch=originalFetch;db.sql.close();assert.deepEqual(errors,[]);});
async function open(){await page.goto(origin+'/account.html');await page.waitForFunction(()=>document.getElementById('submit').disabled===false);}
async function login(){await open();await page.locator('#email').fill('alice@example.com');await page.locator('#password').fill('a long test password');await page.locator('#submit').click();await page.locator('#account-dashboard').waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('session-list').textContent.includes('current'));}
test('mobile account UI remains safely disabled before activation',async()=>{
 enabled=false;await page.goto(origin+'/account.html');await page.waitForFunction(()=>Boolean(window.UvenaroAuth));
 assert.equal(await page.locator('#submit').isDisabled(),true);assert.equal(provider.providerCalls,0);assert.equal(await page.locator('#account-dashboard').isHidden(),true);
});
test('same-origin browser signup creates a real backend session and hides unavailable methods',async()=>{
 await open();await page.locator('#register-tab').click();await page.locator('#name').fill('Alice Creator');await page.locator('#email').fill('alice@example.com');await page.locator('#password').fill('a long test password');await page.locator('#submit').click();
 await page.waitForFunction(()=>document.getElementById('profile-name').textContent==='Alice Creator');assert.equal(await page.locator('#password').inputValue(),'');
 assert.equal(await page.locator('[data-provider="google"]').isDisabled(),true);assert.equal(await page.locator('#passkey').isDisabled(),true);
 const cookies=await ctx.cookies();assert.ok(cookies.some(c=>c.name==='__Host-uvenaro-session'&&c.httpOnly&&c.secure));
 assert.equal(await page.evaluate(()=>Object.entries(localStorage).some(([,value])=>value.includes('uv1.')||value.includes('a long test password'))),false);
 await page.screenshot({path:'/tmp/uvenaro-account-mobile.png',fullPage:true});
});
test('session restores after reload and logout prevents silent restoration',async()=>{
 await login();await page.reload();await page.locator('#account-dashboard').waitFor({state:'visible'});await page.locator('#sign-out').click();await page.locator('#account-dashboard').waitFor({state:'hidden'});
 await page.reload();await page.waitForFunction(()=>Boolean(window.UvenaroAuth));assert.equal(await page.locator('#account-dashboard').isHidden(),true);
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM account_sessions WHERE revoked_at IS NULL').get().n,0);
});
test('password reset dialog requests recovery and shows a generic result',async()=>{
 await open();await page.locator('#forgot-password').click();await page.locator('#step-email').fill('alice@example.com');await page.locator('#step-submit').click();
 await page.waitForFunction(()=>document.getElementById('service-status').textContent.includes('eligible'));assert.equal(provider.calls.at(-1).input.requestType,'PASSWORD_RESET');
});
test('password change completes the required reauthentication UI and signs out',async()=>{
 await login();db.sql.exec('UPDATE account_sessions SET authenticated_at=0');await page.locator('#change-password').click();await page.locator('#step-password').fill('a different long password');await page.locator('#step-confirm').fill('a different long password');await page.locator('#step-submit').click();
 await page.waitForFunction(()=>document.getElementById('step-title').textContent==='Confirm your identity');await page.locator('#step-password').fill('a long test password');await page.locator('#step-submit').click();
 await page.waitForFunction(()=>document.getElementById('service-status').textContent.includes('Password changed'));assert.equal(await page.locator('#account-dashboard').isHidden(),true);
});
test('authenticator challenge is required before the browser can show a signed-in account',async()=>{
 provider.mfa=true;await open();await page.locator('#email').fill('alice@example.com');await page.locator('#password').fill('a long test password');await page.locator('#submit').click();
 await page.locator('#step-code').waitFor({state:'visible'});assert.equal(await page.locator('#account-dashboard').isHidden(),true);await page.locator('#step-code').fill('123456');await page.locator('#step-submit').click();
 await page.waitForFunction(()=>document.getElementById('profile-security').textContent.includes('Authenticator enabled'));
});
test('authenticator enrollment shows its setup key, verifies a code and clears the setup secret',async()=>{
 await login();await page.locator('[data-security-action="mfa"]').click();await page.locator('#step-code').waitFor({state:'visible'});assert.match(await page.locator('#step-description').textContent(),/JBSWY3DPEHPK3PXP/);
 await page.locator('#step-code').fill('123456');await page.locator('#step-submit').click();await page.locator('#account-step').waitFor({state:'hidden'});assert.equal(await page.locator('#step-description').textContent(),'');assert.equal(await page.locator('#account-dashboard').isHidden(),true);
});
test('account export downloads real owner records without session secrets',async()=>{
 await login();const downloaded=page.waitForEvent('download');await page.locator('#dashboard-export').click();const file=await downloaded;const out=JSON.parse(await readFile(await file.path(),'utf8'));
 assert.equal(out.user.id,'alice');assert.ok(out.records.sessions.length);assert.ok(!JSON.stringify(out).includes('credentials_cipher'));assert.ok(!JSON.stringify(out).includes('refresh-alice'));
});
test('deletion UI records and cancels a request without claiming that data was erased',async()=>{
 await login();await page.locator('#delete-account').click();await page.locator('#step-confirmation').fill('DELETE');await page.locator('#step-submit').click();
 await page.waitForFunction(()=>document.getElementById('deletion-status').textContent.includes('not yet been deleted'));await page.locator('#cancel-deletion').click();await page.locator('#cancel-deletion').waitFor({state:'hidden'});
 assert.equal(db.sql.prepare('SELECT status FROM account_profiles').get().status,'active');
 await page.setViewportSize({width:1365,height:900});await page.screenshot({path:'/tmp/uvenaro-account-desktop.png',fullPage:true});
});

test('account forms purge old drafts and never autosave email or verification codes',async()=>{
 await ctx.addInitScript(()=>localStorage.setItem('uvenaro:route-recovery:/account.html',JSON.stringify({values:{email:{kind:'value',value:'old@example.com'}}})));
 provider.mfa=true;await open();assert.equal(await page.locator('.uvenaro-recovery-overlay').count(),0);
 await page.locator('#email').fill('alice@example.com');await page.locator('#password').fill('a long test password');await page.locator('#submit').click();await page.locator('#step-code').fill('123456');
 await page.evaluate(()=>window.UvenaroPlatform.saveRecovery('test'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('uvenaro:route-recovery:/account.html')),null);
});
