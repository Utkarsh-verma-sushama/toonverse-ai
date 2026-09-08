(() => {
"use strict";
const DB="toonverse-ai-jobs", VERSION=1, STORE="jobs";
const supportedModes=new Set(["generate","cartoon","wallpaper","coloring","memory","camera","image-text","video-text","batch","ai-enhance","auto-fix","background-remove","background-change","object-remove","upscale","restore","colorize","portrait","lighting","prompt-edit","image-understanding","video-understanding","audio-understanding","ocr","transcribe","translate","summarize","scene-index","accessibility-description"]);
const listeners=new Set();
let activeController=null;
const base=()=>String(window.ToonVerseConfig?.services?.apiBaseUrl||"").replace(/\/$/,"");
const connected=()=>Boolean(base());
const emit=(type,detail={})=>{const event={type,...detail,at:new Date().toISOString()};listeners.forEach(fn=>{try{fn(event)}catch(e){console.error(e)}});window.dispatchEvent(new CustomEvent("toonverse:ai-job",{detail:event}));};
function openDb(){if(!("indexedDB" in globalThis))return Promise.reject(new Error("Offline job storage is unavailable."));return new Promise((resolve,reject)=>{const q=indexedDB.open(DB,VERSION);q.onupgradeneeded=()=>{const db=q.result;if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:"id"});s.createIndex("status","status");s.createIndex("createdAt","createdAt")}};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);q.onblocked=()=>reject(new Error("Job storage is busy in another tab."))})}
async function save(record){const db=await openDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}return record}
async function remove(id){const db=await openDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
async function list(){const db=await openDb();try{return await new Promise((resolve,reject)=>{const q=db.transaction(STORE,"readonly").objectStore(STORE).getAll();q.onsuccess=()=>resolve(q.result.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))));q.onerror=()=>reject(q.error)})}finally{db.close()}}
function validate(input){
 const mode=String(input.mode||"generate");if(!supportedModes.has(mode))throw new Error("Unsupported AI workflow.");
 const prompt=String(input.prompt||"").trim();const files=Array.from(input.files||[]);
 if(!prompt&&!files.length)throw new Error("Add a prompt or reference media.");
 if(prompt.length>4000)throw new Error("Prompt is too long.");
 if(files.length>100)throw new Error("Choose no more than 100 files.");
 let total=0;for(const f of files){total+=Number(f.size)||0;if(f.size>500*1024*1024)throw new Error(`${f.name} is too large.`);if(!/^(image|video|audio)\//.test(f.type))throw new Error(`${f.name} is not supported.`)}
 if(total>2*1024*1024*1024)throw new Error("Selected media exceeds the safe batch limit.");
 return {mode,prompt,files,settings:{outputType:String(input.settings?.outputType||"image"),aspectRatio:String(input.settings?.aspectRatio||"1:1"),quality:String(input.settings?.quality||"standard"),variations:Math.max(1,Math.min(8,Number(input.settings?.variations)||1)),preserveOriginal:input.settings?.preserveOriginal!==false,
language:String(input.settings?.language||"auto"),outputLanguage:String(input.settings?.outputLanguage||"auto"),
features:input.settings?.features&&typeof input.settings.features==="object"?input.settings.features:{},
consent:Boolean(input.settings?.consent),retention:String(input.settings?.retention||"ephemeral"),
integrity:Array.isArray(input.settings?.integrity)?input.settings.integrity:[],
contractVersion:String(input.settings?.contractVersion||"1.0")}};
}
async function token(){if(!window.ToonVerseAuth)return"";try{return await window.ToonVerseAuth.getAccessToken()}catch{return""}}
async function request(path,options={}){
 const controller=activeController=new AbortController();const timer=setTimeout(()=>controller.abort(),120000);
 try{const headers=new Headers(options.headers||{});const t=await token();if(t)headers.set("Authorization",`Bearer ${t}`);headers.set("Accept","application/json");const response=await fetch(`${base()}${path}`,{...options,headers,credentials:"include",cache:"no-store",signal:controller.signal});const body=await response.json().catch(()=>({}));if(!response.ok){const e=new Error(body.message||"AI request failed.");e.code=body.code||`HTTP_${response.status}`;throw e}return body}finally{clearTimeout(timer);if(activeController===controller)activeController=null}
}
async function submit(raw){
 const input=validate(raw);const localId=crypto.randomUUID?.()||`job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 const record={id:localId,status:connected()&&navigator.onLine?"preparing":"queued",mode:input.mode,prompt:input.prompt,settings:input.settings,fileMeta:input.files.map(f=>({name:f.name,type:f.type,size:f.size,lastModified:f.lastModified})),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),progress:0};
 await save(record).catch(()=>record);emit(record.status,{job:record});
 if(!connected()){emit("service-unavailable",{job:record});return record}
 if(!navigator.onLine){emit("queued",{job:record});return record}
 try{
   const form=new FormData();form.set("clientJobId",localId);form.set("mode",input.mode);form.set("prompt",input.prompt);form.set("settings",JSON.stringify(input.settings));input.files.forEach(f=>form.append("media",f,f.name));
   const created=await request("/v1/ai/jobs",{method:"POST",body:form,headers:{"Idempotency-Key":localId}});
   const next={...record,id:String(created.id||localId),status:String(created.status||"queued"),progress:Number(created.progress)||0,updatedAt:new Date().toISOString()};
   if(next.id!==localId)await remove(localId).catch(()=>{});await save(next).catch(()=>next);emit("submitted",{job:next});return next;
 }catch(error){const failed={...record,status:error.name==="AbortError"?"cancelled":"failed",errorCode:error.code||error.name||"UNKNOWN",errorMessage:error.name==="AbortError"?"Generation cancelled.":error.message,updatedAt:new Date().toISOString()};await save(failed).catch(()=>failed);emit(failed.status,{job:failed,error});throw error}
}
async function status(id){if(!connected())throw new Error("AI service is not connected.");const data=await request(`/v1/ai/jobs/${encodeURIComponent(id)}`);const record={...data,id:String(data.id||id),updatedAt:new Date().toISOString()};await save(record).catch(()=>record);emit("progress",{job:record});return record}
async function cancel(id){activeController?.abort();if(connected()&&id)await request(`/v1/ai/jobs/${encodeURIComponent(id)}/cancel`,{method:"POST"}).catch(()=>{});emit("cancelled",{job:{id,status:"cancelled"}})}
async function retry(id){const jobs=await list();const old=jobs.find(j=>j.id===id);if(!old)throw new Error("Saved job not found.");return submit({mode:old.mode,prompt:old.prompt,settings:old.settings,files:[]})}
function subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}
window.addEventListener("online",()=>emit("online"));
window.addEventListener("offline",()=>emit("offline"));
window.ToonVerseAIJobs=Object.freeze({connected,validate,submit,status,cancel,retry,list,subscribe,supportedModes:Object.freeze([...supportedModes])});
})();