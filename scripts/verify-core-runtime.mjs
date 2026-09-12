import {access,readFile,readdir} from "node:fs/promises";import vm from "node:vm";
const files=["assets/js/model-router.js","assets/js/agent-runtime.js","assets/js/platform-runtime.js","backend/worker.mjs"];
for(const file of files){const source=await readFile(new URL("../"+file,import.meta.url),"utf8");if(!source.trim())throw new Error(file+" is empty.");if(file.endsWith(".js"))new vm.Script(source,{filename:file});}
const serviceWorker=await readFile(new URL("../sw.js",import.meta.url),"utf8");
const coreMatch=serviceWorker.match(/const CORE = \[([\s\S]*?)\];/);
if(!coreMatch)throw new Error("Service worker CORE asset list is missing.");
const cachedAssets=[...coreMatch[1].matchAll(/["']\.\/([^"']+)["']/g)].map(match=>match[1]);
for(const asset of cachedAssets)await access(new URL("../"+asset,import.meta.url)).catch(()=>{throw new Error("Service worker references a missing asset: "+asset)});
if(new Set(cachedAssets).size!==cachedAssets.length)throw new Error("Service worker CORE asset list contains duplicates.");
const htmlRoutes=(await readdir(new URL("../",import.meta.url))).filter(name=>name.endsWith(".html"));
for(const route of htmlRoutes){
 const source=await readFile(new URL("../"+route,import.meta.url),"utf8");
 const references=[...source.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map(match=>match[1]);
 for(const reference of references){
  if(!reference.startsWith("./")||reference.startsWith("//"))continue;
  const clean=reference.slice(2).split(/[?#]/)[0];
  if(!clean)continue;
  await access(new URL("../"+clean,import.meta.url)).catch(()=>{throw new Error(route+" references a missing local asset or route: "+reference)});
 }
}
const schema=await readFile(new URL("../backend/schema.sql",import.meta.url),"utf8");
for(const table of ["agent_runs","agent_steps","agent_approvals","route_decisions","audit_events"])if(!schema.includes("CREATE TABLE IF NOT EXISTS "+table))throw new Error("Missing table "+table);
const platformRuntime=await readFile(new URL("../assets/js/platform-runtime.js",import.meta.url),"utf8");
for(const contract of ["toonverse-network-status","installNetworkStatus","Network status: online","Network status: offline","data-state=online","data-state=offline"])if(!platformRuntime.includes(contract))throw new Error("Missing global network-status contract: "+contract);
const config=await readFile(new URL("../assets/js/config.js",import.meta.url),"utf8");
for(const flag of ["autonomousAgents","multimodalModelRouting","cloudBackend"])if(!config.includes(flag+": false"))throw new Error(flag+" must default to safe-off.");
const privacy=await readFile(new URL("../privacy.html",import.meta.url),"utf8");
const terms=await readFile(new URL("../terms.html",import.meta.url),"utf8");
const storeListing=JSON.parse(await readFile(new URL("../store-assets/store-listing.json",import.meta.url),"utf8"));
for(const [name,source] of [["privacy.html",privacy],["terms.html",terms]])if(!source.includes("Utkarsh Prakash Verma"))throw new Error(name+" must identify the verified interim operator.");
if(!privacy.includes("Google Firebase")||!privacy.includes("No production AI model provider"))throw new Error("Privacy provider disclosure is incomplete.");
if(storeListing.status?.aiProvider!=="not-selected-or-connected")throw new Error("Store metadata must not claim an unselected AI provider.");
if(!String(storeListing.status?.cloudFoundation||"").includes("Google Firebase"))throw new Error("Store metadata cloud foundation is incomplete.");
const matrix=JSON.parse(await readFile(new URL("../docs/ecosystem-essential-capability-matrix.json",import.meta.url),"utf8"));
for(const platform of ["web","android","ios","windows","macos","linux","tabletFoldable","tv"])if(!matrix.platforms[platform])throw new Error("Missing platform "+platform);
console.log("Verified agent guardrails, routing, cloud, platform adaptation and durable schema.");