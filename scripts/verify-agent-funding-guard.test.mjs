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
