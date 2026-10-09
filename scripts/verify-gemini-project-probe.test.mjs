import test from 'node:test';
import assert from 'node:assert/strict';
import {runGeminiProjectProbe} from './probe-gemini-project.mjs';

const secret='AIzaSyDUMMY_PROBE_SECRET_NEVER_PRINTED_123456';

function response(body,status=200){
 return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}

test('probe verifies model listing and countTokens without generation',async()=>{
 const calls=[];
 const report=await runGeminiProjectProbe({
  apiKey:secret,
  model:'gemini-3.8-flash',
  fetcher:async(url,options)=>{
   calls.push({url,method:options.method,body:options.body});
   if(options.method==='GET')return response({models:[{name:'models/gemini-3.8-flash',supportedGenerationMethods:['countTokens','generateContent']}]});
   return response({totalTokens:7});
  }
 });
 assert.equal(report.verified,true);
 assert.equal(report.generationCalled,false);
 assert.equal(report.providerRequestsPermitted,false);
 assert.equal(report.modelList.modelFound,true);
 assert.deepEqual(report.modelList.supportedMethods,['countTokens','generateContent']);
 assert.equal(report.countTokens.totalTokens,7);
 assert.equal(report.credential.keyPresent,true);
 assert.match(report.credential.digest,/^[a-f0-9]{64}$/);
 assert.equal(report.credential.acknowledgements.declared,true);
 assert.equal(JSON.stringify(report).includes(secret),false);
 assert.equal(calls.length,2);
 assert.equal(calls[0].method,'GET');
 assert.equal(calls[1].url.endsWith('/models/gemini-3.8-flash:countTokens'),true);
 assert.equal(calls.some(call=>call.url.includes('generateContent')),false);
 assert.equal(JSON.stringify(report).includes(secret),false);
});

test('probe fails closed on missing model without calling generation',async()=>{
 const report=await runGeminiProjectProbe({
  apiKey:secret,
  model:'gemini-3.8-flash',
  fetcher:async()=>response({models:[]})
 });
 assert.equal(report.verified,false);
 assert.ok(report.errors.includes('PROBE_MODEL_NOT_LISTED'));
 assert.equal(report.generationCalled,false);
});

test('probe sanitizes provider HTTP and network failures',async()=>{
 const http=await runGeminiProjectProbe({
  apiKey:secret,
  fetcher:async()=>response({error:{message:secret}},403)
 });
 assert.equal(http.verified,false);
 assert.ok(http.errors.includes('PROBE_MODELS_LIST_HTTP_ERROR'));
 assert.equal(JSON.stringify(http).includes(secret),false);
 const network=await runGeminiProjectProbe({
  apiKey:secret,
  fetcher:async()=>{throw new Error(secret);}
 });
 assert.equal(network.verified,false);
 assert.ok(network.errors.includes('PROBE_NETWORK_ERROR'));
 assert.equal(JSON.stringify(network).includes(secret),false);
});
