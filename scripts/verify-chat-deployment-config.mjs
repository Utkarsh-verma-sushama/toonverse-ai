import fs from 'node:fs';

const path=new URL('../backend/wrangler.toml.example',import.meta.url);
const source=fs.readFileSync(path,'utf8');
const required=[
 ['AGENT_EXECUTION_ENABLED','false'],
 ['AGENT_PAID_EXECUTION_CONFIRMATION',''],
 ['AGENT_PROVIDER_DISPATCH_ENABLED','false'],
 ['AGENT_PROVIDER_ALLOWED_ORIGIN',''],
 ['AGENT_PROVIDER_APPROVED_ORIGIN',''],
 ['AGENT_PROVIDER_GATEWAY_AUDITED','false'],
 ['AGENT_PROVIDER',''],
 ['AGENT_MODEL',''],
 ['AGENT_GLOBAL_DAILY_COST_MICROUSD','0'],
 ['CHAT_EXECUTION_ENABLED','false'],
 ['CHAT_PAID_EXECUTION_CONFIRMATION',''],
 ['CHAT_RECONCILIATION_CONFIRMATION',''],
 ['CHAT_PROVIDER',''],
 ['CHAT_MODEL',''],
 ['CHAT_PROVIDER_URL',''],
 ['CHAT_PROVIDER_ALLOWED_ORIGIN',''],
 ['CHAT_PROVIDER_APPROVED_ORIGIN',''],
 ['CHAT_PROVIDER_GATEWAY_AUDITED','false'],
 ['CHAT_GLOBAL_DAILY_COST_MICROUSD','0']
];
for(const [key,value] of required){
 const line=key+' = "'+value+'"';
 if(!source.split(/\r?\n/).some(v=>v.trim()===line))throw new Error('Unsafe production example default: '+key);
}
if(/^\s*CHAT_PROVIDER_API_KEY\s*=/m.test(source)||/^\s*AGENT_PROVIDER_API_KEY\s*=/m.test(source))throw new Error('Provider API key must never be committed to Wrangler config.');
for(const key of ['CHAT_PROVIDER_PROTOCOL','AGENT_PROVIDER_PROTOCOL'])if(!source.split(/\r?\n/).some(v=>v.trim()===key+' = "metered-v1"'))throw new Error('Audited metered provider protocol invariant failed: '+key);
console.log('Verified production chat and agent deployment example remains fail-closed and secret-free.');
