import {access,readFile} from "node:fs/promises";import vm from "node:vm";
const files=["assets/js/model-router.js","assets/js/agent-runtime.js","assets/js/platform-runtime.js","backend/worker.mjs"];
for(const file of files){const source=await readFile(new URL("../"+file,import.meta.url),"utf8");if(!source.trim())throw new Error(file+" is empty.");if(file.endsWith(".js"))new vm.Script(source,{filename:file});}
const serviceWorker=await readFile(new URL("../sw.js",import.meta.url),"utf8");
const coreMatch=serviceWorker.match(/const CORE = \[([\s\S]*?)\];/);
if(!coreMatch)throw new Error("Service worker CORE asset list is missing.");
const cachedAssets=[...coreMatch[1].matchAll(/["']\.\/([^"']+)["']/g)].map(match=>match[1]);
for(const asset of cachedAssets)await access(new URL("../"+asset,import.meta.url)).catch(()=>{throw new Error("Service worker references a missing asset: "+asset)});
if(new Set(cachedAssets).size!==cachedAssets.length)throw new Error("Service worker CORE asset list contains duplicates.");
const schema=await readFile(new URL("../backend/schema.sql",import.meta.url),"utf8");
for(const table of ["agent_runs","agent_steps","agent_approvals","route_decisions","audit_events"])if(!schema.includes("CREATE TABLE IF NOT EXISTS "+table))throw new Error("Missing table "+table);
const config=await readFile(new URL("../assets/js/config.js",import.meta.url),"utf8");
for(const flag of ["autonomousAgents","multimodalModelRouting","cloudBackend"])if(!config.includes(flag+": false"))throw new Error(flag+" must default to safe-off.");
const matrix=JSON.parse(await readFile(new URL("../docs/ecosystem-essential-capability-matrix.json",import.meta.url),"utf8"));
for(const platform of ["web","android","ios","windows","macos","linux","tabletFoldable","tv"])if(!matrix.platforms[platform])throw new Error("Missing platform "+platform);
console.log("Verified agent guardrails, routing, cloud, platform adaptation and durable schema.");