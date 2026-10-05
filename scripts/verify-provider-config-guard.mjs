import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const scanRoots=['backend','deploy','.github/workflows'];
const allowedText=/\.(?:mjs|js|json|ya?ml|toml|example)$/i;
const files=[];
function walk(rel){const abs=path.join(root,rel);for(const entry of fs.readdirSync(abs,{withFileTypes:true})){const child=path.join(rel,entry.name);if(entry.isDirectory())walk(child);else if(allowedText.test(entry.name))files.push(child);}}
for(const rel of scanRoots)walk(rel);
const violations=[];
const rawVendor=/https:\/\/(?:api\.openai\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com)(?:[/:]|$)/i;
const likelySecrets=[/\bsk-[A-Za-z0-9_-]{20,}\b/g,/\bAIza[0-9A-Za-z_-]{30,}\b/g,/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g];
for(const rel of files){
 const source=fs.readFileSync(path.join(root,rel),'utf8');
 // Runtime code contains defensive deny-lists and tests contain fixtures; deployment
 // surfaces are the dangerous place for a literal raw-vendor route or enabled flag.
 if((rel.startsWith('deploy/')||rel.startsWith('.github/workflows/')||/wrangler/i.test(rel))&&rawVendor.test(source))violations.push(rel+': raw model-vendor URL in deployment surface');
 if((rel.startsWith('deploy/')||/wrangler/i.test(rel))&&/^\s*CHAT_EXECUTION_ENABLED\s*[=:]\s*["']?true["']?\s*[,;]?\s*$/mi.test(source))violations.push(rel+': paid chat enabled in checked-in deployment config');
 if((rel.startsWith('deploy/')||/wrangler/i.test(rel))&&/^\s*AGENT_EXECUTION_ENABLED\s*[=:]\s*["']?true["']?\s*[,;]?\s*$/mi.test(source))violations.push(rel+': paid agent execution enabled in checked-in deployment config');
 if((rel.startsWith('deploy/')||/wrangler/i.test(rel))&&/^\s*AGENT_PROVIDER_DISPATCH_ENABLED\s*[=:]\s*["']?true["']?\s*[,;]?\s*$/mi.test(source))violations.push(rel+': paid agent provider dispatch enabled in checked-in deployment config');
 for(const pattern of likelySecrets){pattern.lastIndex=0;if(pattern.test(source))violations.push(rel+': provider-shaped secret literal detected');}
 if(/^\s*CHAT_PROVIDER_API_KEY\s*[=:]\s*["'][^"']+["']/mi.test(source))violations.push(rel+': provider API key literal detected');
 if(/^\s*AGENT_PROVIDER_API_KEY\s*[=:]\s*["'][^"']+["']/mi.test(source))violations.push(rel+': agent provider API key literal detected');
}
if(violations.length)throw new Error('Unsafe paid-provider configuration:\n'+violations.join('\n'));
console.log('Verified deployment surfaces contain no enabled paid-chat/agent dispatch flag, raw vendor route, or provider-shaped secret.');
