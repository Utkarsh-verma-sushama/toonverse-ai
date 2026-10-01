import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {browser as launchBrowser} from './browser-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));let browser,server,origin,ctx,page,enabled=true,errors,calls,respond;
before(async()=>{
 browser=await launchBrowser();
 server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,origin).pathname);
  if(!path.startsWith(root)){res.writeHead(403);res.end();return;}
  try{
   let body=await readFile(path);
   if(path.endsWith('/config.js'))body=Buffer.from(body.toString().replace('apiBaseUrl: ""','apiBaseUrl: "'+origin+'"').replace('chatCore: false','chatCore: '+enabled));
   res.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream'});res.end(body);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
beforeEach(async()=>{
 enabled=true;errors=[];calls=[];respond=async route=>route.fulfill({json:{id:'test-answer',output:'<img src=x onerror=alert(1)> Safe text',usage:{credits:2}}});
 ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 page=await ctx.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 // Identity SDK substitute only; tests exercise the shipped chat page/scripts.
 // Worker/D1/real signature verification run separately in verify-chat-workerd.
 await page.route('**/assets/js/auth.js',route=>route.fulfill({contentType:'application/javascript',body:`
 window.testUid='alice';window.UvenaroAuth={getState:()=>({user:window.testUid?{id:window.testUid}:null}),restore:async()=>{},getAccessToken:async()=> 'fixture-token'};
 window.testSwitch=id=>{window.testUid=id;window.dispatchEvent(new Event('uvenaro:auth-change'));};`}));
 await page.route('**/v1/chat/**',async route=>{calls.push({url:route.request().url(),headers:route.request().headers(),body:route.request().postData()});await respond(route);});
});
afterEach(async()=>{await ctx.close();assert.deepEqual(errors,[]);});
async function open(){await page.goto(origin+'/chat.html');await page.waitForFunction(()=>Boolean(window.UvenaroChat));}
async function send(text='Hello'){await page.locator('#input').fill(text);await page.locator('#send').click();}
async function idle(){await page.waitForFunction(()=>document.getElementById('form').getAttribute('aria-busy')==='false');}

test('mobile chat safe-off saves locally and never sends a provider request',async()=>{
 enabled=false;await open();await send();await idle();assert.equal(calls.length,0);
 assert.match(await page.locator('#request-status').textContent(),/without provider cost/);assert.equal(await page.locator('#stop-request').isHidden(),true);
});
test('mobile chat renders provider text safely and sends a replay nonce',async()=>{
 await open();await send();await idle();assert.match(await page.locator('#log').textContent(),/Safe text/);
 assert.equal(await page.locator('#log img').count(),0);assert.match(calls[0].headers['x-uvenaro-nonce'],/^[A-Za-z0-9_-]{32,128}$/);
 assert.equal(await page.locator('#input').inputValue(),'');assert.equal(await page.locator('#stop-request').isHidden(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('stop and reload retain the same request until its credit receipt is confirmed',async()=>{
 const held=[];respond=route=>{held.push(route);};
 await open();await send();await page.waitForFunction(()=>window.UvenaroChat.pending());
 await page.locator('#stop-request').click();await idle();assert.match(await page.locator('#request-status').textContent(),/may still finish and use credits/);
 assert.equal(await page.locator('#check-request').isVisible(),true);assert.equal(await page.evaluate(()=>UvenaroChat.pending()),true);
 const originalKey=calls[0].headers['idempotency-key'];await page.reload();
 respond=route=>route.fulfill({json:{id:'reservation',status:'settled',credits:2,inputTokens:10,outputTokens:5}});
 await page.locator('#check-request').click();await idle();assert.ok(calls[1].url.endsWith(originalKey));
 assert.match(await page.locator('#request-status').textContent(),/used 2 credits/);assert.match(await page.locator('#log').textContent(),/Reply unavailable/);
 assert.equal(calls.filter(c=>c.url.endsWith('/responses')).length,1);assert.equal(await page.evaluate(()=>UvenaroChat.pending()),false);
 for(const route of held)await route.abort().catch(()=>{});
});
test('logout during an active chat clears the draft and never displays a late private reply',async()=>{
 const held=[];respond=route=>{held.push(route);};await open();await send('Alice private draft');
 await page.waitForFunction(()=>window.UvenaroChat.pending());await page.evaluate(()=>window.testSwitch(null));await idle();
 await page.evaluate(()=>window.testSwitch('bob'));assert.equal(await page.locator('#input').inputValue(),'');assert.equal(await page.locator('#log').textContent(),'');
 for(const route of held)await route.fulfill({json:{output:'Alice private answer'}}).catch(()=>{});
 assert.equal(await page.locator('#log').textContent(),'');assert.equal(await page.locator('#request-status').textContent(),'');
 assert.equal(await page.evaluate(()=>localStorage.getItem('uvenaro.chat.v2:alice').includes('private answer')),false);
});
