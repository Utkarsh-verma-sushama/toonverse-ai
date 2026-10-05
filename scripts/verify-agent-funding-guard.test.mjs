import test from 'node:test';
import assert from 'node:assert/strict';
import {agentConfig} from '../backend/agent-runtime.mjs';

const base={
 ENVIRONMENT:'production',
 AGENT_EXECUTION_ENABLED:'true',
 AGENT_PROVIDER_DISPATCH_ENABLED:'true',
 AGENT_PROVIDER:'test-gateway',
 AGENT_MODEL:'test-agent',
 AGENT_PROVIDER_URL:'https://metered.example.invalid/agent',
 AGENT_PROVIDER_ALLOWED_ORIGIN:'https://metered.example.invalid',
 AGENT_PROVIDER_APPROVED_ORIGIN:'https://metered.example.invalid',
 AGENT_PROVIDER_GATEWAY_AUDITED:'true',
 AGENT_PROVIDER_PROTOCOL:'metered-v1',
 AGENT_PROVIDER_API_KEY:'server-test-secret',
 AGENT_GLOBAL_DAILY_COST_MICROUSD:'100000'
};

test('production agent execution requires independent paid-spend confirmation',()=>{
 for(const value of ['', 'false', 'TRUE', 'UVENARO_ENABLE_PAID_CHAT']){
  assert.throws(()=>agentConfig({...base,AGENT_PAID_EXECUTION_CONFIRMATION:value}),error=>error?.code==='AGENT_PAID_EXECUTION_CONFIRMATION_REQUIRED');
 }
});

test('production agent confirmation is exact and still requires provider contract',()=>{
 const cfg=agentConfig({...base,AGENT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_AGENT'});
 assert.equal(cfg.enabled,true);assert.equal(cfg.dispatchEnabled,true);
 assert.equal(cfg.url,'https://metered.example.invalid/agent');
});

test('safe-off agent flag does not require confirmation',()=>{
 assert.deepEqual(agentConfig({...base,AGENT_EXECUTION_ENABLED:'false',AGENT_PAID_EXECUTION_CONFIRMATION:''}),{enabled:false});
});

test('production agent dispatch rejects raw model-vendor routes',()=>{
 for(const origin of ['https://api.openai.com','https://api.anthropic.com','https://generativelanguage.googleapis.com']){
  assert.throws(()=>agentConfig({...base,AGENT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_AGENT',AGENT_PROVIDER_URL:origin+'/v1/run',AGENT_PROVIDER_ALLOWED_ORIGIN:origin,AGENT_PROVIDER_APPROVED_ORIGIN:origin}),error=>error?.code==='AGENT_RAW_PROVIDER_ROUTE_FORBIDDEN');
 }
});

test('production agent dispatch requires audited pinned gateway',()=>{
 const confirmed={...base,AGENT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_AGENT'};
 assert.throws(()=>agentConfig({...confirmed,AGENT_PROVIDER_GATEWAY_AUDITED:'false'}),error=>error?.code==='AGENT_PROVIDER_GATEWAY_AUDIT_REQUIRED');
 assert.throws(()=>agentConfig({...confirmed,AGENT_PROVIDER_APPROVED_ORIGIN:''}),error=>error?.code==='AGENT_APPROVED_GATEWAY_ORIGIN_REQUIRED');
 assert.throws(()=>agentConfig({...confirmed,AGENT_PROVIDER_APPROVED_ORIGIN:'https://other.example.invalid'}),error=>error?.code==='AGENT_UNAPPROVED_GATEWAY_ROUTE');
});

test('production agent approved gateway origin must be canonical HTTPS origin',()=>{
 const confirmed={...base,AGENT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_AGENT'};
 for(const origin of ['http://metered.example.invalid','https://metered.example.invalid/','https://user:pass@metered.example.invalid','https://metered.example.invalid/path','https://metered.example.invalid?q=1','https://metered.example.invalid#x'])
  assert.throws(()=>agentConfig({...confirmed,AGENT_PROVIDER_APPROVED_ORIGIN:origin}),error=>error?.code==='AGENT_APPROVED_GATEWAY_ORIGIN_INVALID');
});

test('production agent raw-vendor deny-list survives DNS trailing-dot variants',()=>{
 const confirmed={...base,AGENT_PAID_EXECUTION_CONFIRMATION:'UVENARO_ENABLE_PAID_AGENT'};
 for(const host of ['api.openai.com.','api.openai.com..','api.anthropic.com.','api.anthropic.com..','generativelanguage.googleapis.com.','generativelanguage.googleapis.com..']){
  const origin='https://'+host;
  assert.throws(()=>agentConfig({...confirmed,AGENT_PROVIDER_URL:origin+'/v1/run',AGENT_PROVIDER_ALLOWED_ORIGIN:origin,AGENT_PROVIDER_APPROVED_ORIGIN:origin}),error=>error?.code==='AGENT_RAW_PROVIDER_ROUTE_FORBIDDEN');
 }
});

test('agent provider dispatch is statically ordered after reservation and durable begin-dispatch',async()=>{
 const source=(await import('node:fs')).readFileSync(new URL('../backend/agent-runtime.mjs',import.meta.url),'utf8');
 const reserve=source.indexOf('reservation=await reserveAgentBudget');
 const begin=source.indexOf('await beginDispatch',reserve);
 const fetch=source.indexOf('await fetchWithoutRedirect',begin);
 assert.ok(reserve>=0&&begin>reserve&&fetch>begin,'provider fetch must follow reservation and beginDispatch');
});

test('agent ambiguous provider failures are held for reconciliation, never released',async()=>{
 const source=(await import('node:fs')).readFileSync(new URL('../backend/agent-runtime.mjs',import.meta.url),'utf8');
 const fetch=source.indexOf('await fetchWithoutRedirect');
 const unknown=source.indexOf('await holdAgentUnknown',fetch);
 const required=source.indexOf("error_code='AGENT_RECONCILIATION_REQUIRED'",fetch);
 assert.ok(fetch>=0&&unknown>fetch&&required>unknown);
 const ambiguous=source.slice(fetch,required);
 assert.doesNotMatch(ambiguous,/releaseChat\s*\(/,'ambiguous dispatch outcome must not release reserved spend');
});
