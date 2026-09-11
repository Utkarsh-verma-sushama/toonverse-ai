(() => {
"use strict";
const DB="toonverse-agent-runs",VERSION=1,STORE="runs";
const terminal=new Set(["completed","failed","cancelled","expired"]);
const risky=new Set(["delete","publish","share","purchase","send","external-write","account-change"]);
const base=()=>String(window.ToonVerseConfig?.services?.apiBaseUrl||"").replace(/\/$/,"");
function openDb(){return new Promise((resolve,reject)=>{if(!indexedDB)return reject(new Error("Agent storage unavailable."));const q=indexedDB.open(DB,VERSION);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE,{keyPath:"id"})};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}
async function persist(run){const db=await openDb();try{await new Promise((ok,no)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(run);tx.oncomplete=ok;tx.onerror=()=>no(tx.error)})}finally{db.close()}return run}
function normalize(raw={}){
 const objective=String(raw.objective||"").trim();if(!objective)throw new Error("Agent objective is required.");if(objective.length>4000)throw new Error("Agent objective is too long.");
 const limits=raw.limits||{};return {objective,context:raw.context&&typeof raw.context==="object"?raw.context:{},tools:Array.isArray(raw.tools)?[...new Set(raw.tools.map(String))].slice(0,32):[],
 limits:{maxSteps:Math.max(1,Math.min(50,Number(limits.maxSteps)||12)),maxRuntimeMs:Math.max(5000,Math.min(3600000,Number(limits.maxRuntimeMs)||300000)),maxCostUsd:Math.max(0,Math.min(100,Number(limits.maxCostUsd)||2))},
 policy:{approvalRequired:[...risky],allowExternalWrites:false,allowPurchases:false,allowDestructive:false,retainAudit:true}};
}
async function request(path,options={}){
 if(!base())throw new Error("Cloud agent service is not connected.");const headers=new Headers(options.headers||{});headers.set("Accept","application/json");if(options.body)headers.set("Content-Type","application/json");
 const token=await window.ToonVerseAuth?.getAccessToken?.().catch(()=>null);if(token)headers.set("Authorization",`Bearer ${token}`);
 const response=await fetch(base()+path,{...options,headers,credentials:"include",cache:"no-store"});const body=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(body.message||"Agent request failed."),{code:body.code||`HTTP_${response.status}`});return body;
}
async function start(raw){const spec=normalize(raw),id=crypto.randomUUID?.()||`agent-${Date.now()}`;const local={id,status:"queued",spec,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await persist(local).catch(()=>local);
 const created=await request("/v1/agents/runs",{method:"POST",headers:{"Idempotency-Key":id},body:JSON.stringify({clientRunId:id,...spec})});return persist({...local,...created,id:String(created.id||id),updatedAt:new Date().toISOString()}).catch(()=>created)}
async function status(id){const run=await request(`/v1/agents/runs/${encodeURIComponent(id)}`);await persist(run).catch(()=>run);return run}
async function approve(id,approvalId,decision,reason=""){if(!["approve","deny"].includes(decision))throw new Error("Invalid approval decision.");return request(`/v1/agents/runs/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approvalId)}`,{method:"POST",body:JSON.stringify({decision,reason:String(reason).slice(0,500)})})}
async function cancel(id){return request(`/v1/agents/runs/${encodeURIComponent(id)}/cancel`,{method:"POST"})}
window.ToonVerseAgents=Object.freeze({connected:()=>Boolean(base()),normalize,start,status,approve,cancel,isTerminal:status=>terminal.has(status),approvalActions:Object.freeze([...risky])});
})();