(() => {
"use strict";
const MODES=Object.freeze(["image-understanding","video-understanding","audio-understanding","ocr","transcribe","translate","summarize","scene-index","accessibility-description"]);
const ACCEPT=Object.freeze({
 "image-understanding":["image/jpeg","image/png","image/webp","image/avif","image/heic","image/heif"],
 "video-understanding":["video/mp4","video/webm","video/quicktime"],
 "audio-understanding":["audio/mpeg","audio/mp4","audio/wav","audio/webm","audio/ogg","audio/flac"],
 ocr:["image/jpeg","image/png","image/webp","image/avif","application/pdf"]
});
const MAX_FILE=2*1024*1024*1024, MAX_ITEMS=100, listeners=new Set();
const emit=(type,detail={})=>{const payload={type,...detail,at:new Date().toISOString()};listeners.forEach(fn=>{try{fn(payload)}catch{}});window.dispatchEvent(new CustomEvent("toonverse:multimodal",{detail:payload}))};
function normalizeLanguage(value){const v=String(value||"auto").trim();return /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(v)||v==="auto"?v:"auto"}
function validate(raw={}){
 const mode=String(raw.mode||"image-understanding");
 if(!MODES.includes(mode))throw new Error("Unsupported multimodal workflow.");
 const files=Array.from(raw.files||[]);
 if(!files.length)throw new Error("Choose at least one supported file.");
 if(files.length>MAX_ITEMS)throw new Error("Choose no more than 100 files in one job.");
 let total=0;
 files.forEach(file=>{total+=Number(file.size)||0;if(file.size>MAX_FILE)throw new Error(`${file.name} exceeds the safe per-file limit.`);if(!/^(image|video|audio)\//.test(file.type)&&file.type!=="application/pdf")throw new Error(`${file.name} has an unsupported media type.`)});
 if(total>MAX_FILE)throw new Error("This batch exceeds the 2 GB safe upload limit.");
 const purpose=String(raw.purpose||"").trim();
 if(purpose.length>1000)throw new Error("Purpose is too long.");
 return {mode,files,purpose,language:normalizeLanguage(raw.language),outputLanguage:normalizeLanguage(raw.outputLanguage),features:{
  ocr:raw.features?.ocr!==false,transcript:raw.features?.transcript!==false,summary:raw.features?.summary!==false,
  timestamps:raw.features?.timestamps!==false,objects:Boolean(raw.features?.objects),faces:false,
  accessibility:Boolean(raw.features?.accessibility),speakerLabels:Boolean(raw.features?.speakerLabels)
 },consent:Boolean(raw.consent),preserveOriginal:true,retention:String(raw.retention||"ephemeral")};
}
async function sha256(file){if(!crypto.subtle||file.size>64*1024*1024)return null;const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function submit(raw){
 const input=validate(raw);
 if(input.files.some(f=>/^(image|video)\//.test(f.type))&&!input.consent)throw new Error("Confirm rights and consent before processing personal media.");
 if(!window.ToonVerseAIJobs)throw new Error("The secure AI job runtime is unavailable.");
 const integrity=await Promise.all(input.files.map(async f=>({name:f.name,size:f.size,type:f.type,sha256:await sha256(f)})));
 emit("validated",{mode:input.mode,integrity});
 const job=await window.ToonVerseAIJobs.submit({mode:input.mode,prompt:input.purpose,files:input.files,settings:{
  outputType:"json",preserveOriginal:true,language:input.language,outputLanguage:input.outputLanguage,features:input.features,
  consent:input.consent,retention:input.retention,integrity,contractVersion:"1.0"
 }});
 emit("submitted",{job});return job;
}
function normalizeResult(job={}){
 const result=job.result||job.results||{};
 return Object.freeze({jobId:String(job.id||""),status:String(job.status||"unknown"),summary:String(result.summary||""),
 text:String(result.text||result.transcript||""),language:String(result.language||"und"),segments:Array.isArray(result.segments)?result.segments:[],
 scenes:Array.isArray(result.scenes)?result.scenes:[],objects:Array.isArray(result.objects)?result.objects:[],
 warnings:Array.isArray(job.warnings)?job.warnings:[],provenance:job.provenance||null,confidence:Number.isFinite(result.confidence)?result.confidence:null});
}
function subscribe(fn){if(typeof fn!=="function")throw new TypeError("Listener must be a function.");listeners.add(fn);return()=>listeners.delete(fn)}
window.ToonVerseMultimodal=Object.freeze({modes:MODES,accept:ACCEPT,validate,submit,normalizeResult,subscribe});
})();