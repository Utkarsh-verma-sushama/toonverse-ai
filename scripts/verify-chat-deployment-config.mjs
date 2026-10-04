import fs from 'node:fs';

const path=new URL('../backend/wrangler.toml.example',import.meta.url);
const source=fs.readFileSync(path,'utf8');
const required=[
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
if(/^\s*CHAT_PROVIDER_API_KEY\s*=/m.test(source))throw new Error('Provider API key must never be committed to Wrangler config.');
if(!source.split(/\r?\n/).some(v=>v.trim()==='CHAT_PROVIDER_PROTOCOL = "metered-v1"'))throw new Error('Audited metered provider protocol invariant failed.');
console.log('Verified production chat deployment example remains fail-closed and secret-free.');
