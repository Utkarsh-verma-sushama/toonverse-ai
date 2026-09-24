import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/js/chat-core.js',import.meta.url),'utf8');
function app({data=new Map(),fetch=async()=>{throw new Error('offline');},uid='alice',connected=true,failSave=false}={}){
 const auth={uid};const config={services:{apiBaseUrl:'https://api.example.invalid'},features:{chatCore:connected}};
 const window={UvenaroConfig:config,UvenaroAuth:{getState:()=>({user:auth.uid?{id:auth.uid}:null}),getAccessToken:async()=> 'fake-test-token'}};
 vm.runInNewContext(source,{window,localStorage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>{if(failSave)throw new Error('disk full');data.set(key,value);}},fetch,crypto,AbortController,setTimeout,clearTimeout,console});
 return {chat:window.UvenaroChat,data,auth,config,window};
}
const ok=()=>Response.json({id:'answer',output:'Answer',usage:{credits:2}});

test('safe-off chat saves locally without any network request',async()=>{
 let calls=0;const a=app({connected:false,fetch:async()=>{calls++;return ok();}});assert.equal((await a.chat.send('Hello')).unavailable,true);assert.equal(calls,0);assert.equal(a.chat.pending(),false);
});
test('corrupt local chat JSON cannot crash startup',()=>{
 const a=app({data:new Map([['uvenaro.chat.v2:alice','{broken']])});assert.equal(a.chat.messages().length,0);
});
test('double send while a request is running issues one paid request',async()=>{
 let resolve,calls=0;const a=app({fetch:async()=>{calls++;return new Promise(r=>{resolve=r;});}});
 const first=a.chat.send('Hello');await new Promise(r=>setImmediate(r));
 await assert.rejects(a.chat.send('Hello'),e=>e.code==='REQUEST_IN_PROGRESS');resolve(ok());await first;assert.equal(calls,1);
});
test('network retry retains its original ID and body across page reload',async()=>{
 const calls=[],data=new Map();const a=app({data,fetch:async(url,options)=>{calls.push(options);throw new Error('lost');}});
 await assert.rejects(a.chat.send('Hello'),e=>e.code==='OUTCOME_UNKNOWN');assert.equal(a.chat.pending(),true);
 const b=app({data,fetch:async(url,options)=>{calls.push(options);return ok();}});await b.chat.retry();
 assert.equal(calls.length,2);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(calls[0].body,calls[1].body);
 assert.equal(b.chat.messages().filter(m=>m.role==='user').length,1);assert.equal(b.chat.pending(),false);
});
test('sending the same text while pending retries the existing key',async()=>{
 const calls=[];const a=app({fetch:async(url,options)=>{calls.push(options);if(calls.length===1)throw new Error('lost');return ok();}});
 await assert.rejects(a.chat.send('Hello'));await a.chat.send('Hello');assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(a.chat.messages().length,2);
});
test('pending request blocks different content and clearing history',async()=>{
 let calls=0;const a=app({fetch:async()=>{calls++;throw new Error('lost');}});await assert.rejects(a.chat.send('Hello'));
 await assert.rejects(a.chat.send('Different'),e=>e.code==='REQUEST_PENDING');assert.throws(()=>a.chat.clear(),e=>e.code==='REQUEST_PENDING');assert.equal(calls,1);
});
test('a settled receipt resolves pending state without sending a new model request',async()=>{
 let calls=0;const a=app({fetch:async(url)=>{calls++;if(url.includes('/requests/'))return Response.json({status:'settled',credits:2,inputTokens:10,outputTokens:5});throw new Error('lost');}});
 await assert.rejects(a.chat.send('Hello'));assert.equal((await a.chat.checkPending()).credits,2);assert.equal(a.chat.pending(),false);assert.equal(calls,2);
 assert.equal(a.chat.messages()[0].delivery,'reply_unavailable');assert.equal(a.chat.messages()[0].usage.credits,2);
});
test('released receipt resolves the hold; a new request gets a new key',async()=>{
 const keys=[];let released=false;const a=app({fetch:async(url,options)=>{if(url.includes('/requests/')){released=true;return Response.json({status:'released',credits:0});}keys.push(options.headers['Idempotency-Key']);if(!released)throw new Error('lost');return ok();}});
 await assert.rejects(a.chat.send('Hello'));await a.chat.checkPending();await a.chat.send('Hello');assert.notEqual(keys[0],keys[1]);
});
test('not-found receipt retains the original key for a safe retry',async()=>{
 let firstKey,secondKey;const a=app({fetch:async(url,options)=>{if(url.includes('/requests/'))return Response.json({code:'RESERVATION_NOT_FOUND'},{status:404});if(!firstKey){firstKey=options.headers['Idempotency-Key'];throw new Error('lost');}secondKey=options.headers['Idempotency-Key'];return ok();}});
 await assert.rejects(a.chat.send('Hello'));assert.equal((await a.chat.checkPending()).status,'not_found');assert.equal(a.chat.pending(),true);await a.chat.retry();assert.equal(firstKey,secondKey);
});
test('account changes isolate local messages and pending billing keys',async()=>{
 const a=app();await assert.rejects(a.chat.send('Alice private message'));a.auth.uid='bob';assert.equal(a.chat.messages().length,0);assert.equal(a.chat.pending(),false);
 a.auth.uid='alice';assert.equal(a.chat.messages().length,1);assert.equal(a.chat.pending(),true);a.auth.uid=null;assert.equal(a.chat.messages().length,0);
});
test('cannot send an old pending request after frontend chat is disabled',async()=>{
 let calls=0;const a=app({fetch:async()=>{calls++;throw new Error('lost');}});await assert.rejects(a.chat.send('Hello'));a.config.features.chatCore=false;
 await assert.rejects(a.chat.retry(),e=>e.code==='CHAT_EXECUTION_DISABLED');assert.equal(calls,1);
});
test('server shutdown after a lost reply retains the original pending key for receipt recovery',async()=>{
 let firstKey,calls=0;const a=app({fetch:async(url,options)=>{calls++;if(calls===1){firstKey=options.headers['Idempotency-Key'];throw new Error('lost');}
  if(url.includes('/requests/')){assert.ok(url.endsWith(firstKey));return Response.json({status:'settled',credits:2});}
  return Response.json({code:'CHAT_EXECUTION_DISABLED'},{status:503});}});
 await assert.rejects(a.chat.send('Hello'));await assert.rejects(a.chat.retry(),e=>e.code==='CHAT_EXECUTION_DISABLED');
 assert.equal(a.chat.pending(),true);assert.equal((await a.chat.checkPending()).credits,2);assert.equal(a.chat.pending(),false);
});
test('local persistence failure stops execution before network billing',async()=>{
 let calls=0;const a=app({failSave:true,fetch:async()=>{calls++;return ok();}});await assert.rejects(a.chat.send('Hello'),e=>e.code==='LOCAL_STORAGE_UNAVAILABLE');assert.equal(calls,0);
});
test('explicit quota rejection clears pending without pretending credits were charged',async()=>{
 const a=app({fetch:async()=>Response.json({code:'DAILY_QUOTA_REACHED'},{status:429})});await assert.rejects(a.chat.send('Hello'),e=>e.code==='DAILY_QUOTA_REACHED');assert.equal(a.chat.pending(),false);
});
test('account switch during token refresh prevents a request under the wrong account',async()=>{
 let calls=0;const a=app({fetch:async()=>{calls++;return ok();}});a.window.UvenaroAuth.getAccessToken=async()=>{a.auth.uid='bob';return 'bob-token';};
 await assert.rejects(a.chat.send('Alice private message'),e=>e.code==='ACCOUNT_CHANGED');assert.equal(calls,0);
});
