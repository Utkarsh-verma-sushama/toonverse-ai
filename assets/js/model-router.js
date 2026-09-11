(() => {
"use strict";
const modalities=new Set(["text","image","video","audio","document"]);
const tasks=new Set(["generate","edit","understand","ocr","transcribe","translate","summarize","math","safety"]);
const allowedQuality=new Set(["fast","balanced","high"]);
const allowedPrivacy=new Set(["standard","no-retention","regional"]);
function infer(input={}){
 const files=Array.from(input.files||[]);const present=new Set(["text"]);
 for(const f of files){const type=String(f.type||"").split("/")[0];if(modalities.has(type))present.add(type);else if(/pdf|document|text/.test(f.type||""))present.add("document")}
 const mode=String(input.mode||"generate");
 let task=/ocr|image-text/.test(mode)?"ocr":/transcribe|audio/.test(mode)?"transcribe":/translate/.test(mode)?"translate":/summar/.test(mode)?"summarize":/math/.test(mode)?"math":/understanding|scene-index|accessibility/.test(mode)?"understand":/edit|remove|restore|colorize|upscale|lighting|portrait|cartoon/.test(mode)?"edit":"generate";
 return {modalities:[...present],task};
}
function policy(input={}){
 const detected=infer(input),settings=input.settings||{};
 const quality=allowedQuality.has(settings.quality)?settings.quality:"balanced";
 const privacy=allowedPrivacy.has(settings.privacy)?settings.privacy:(settings.retention==="ephemeral"?"no-retention":"standard");
 return Object.freeze({contractVersion:"1.0",task:tasks.has(detected.task)?detected.task:"generate",modalities:detected.modalities,quality,privacy,
 latencyBudgetMs:Math.max(1000,Math.min(120000,Number(settings.latencyBudgetMs)||30000)),
 costCeilingUsd:Math.max(0,Math.min(100,Number(settings.costCeilingUsd)||1)),
 region:String(settings.region||"auto"),fallbacks:Math.max(0,Math.min(3,Number.isFinite(Number(settings.fallbacks))?Number(settings.fallbacks):2)),
 requireProvenance:true,allowTraining:false});
}
function validateRoute(route){
 if(!route||typeof route!=="object")throw new Error("Invalid model route.");
 if(!route.routeId||!route.provider||!route.model)throw new Error("Incomplete model route.");
 if(route.expiresAt&&Date.parse(route.expiresAt)<=Date.now())throw new Error("Model route expired.");
 return route;
}
window.ToonVerseModelRouter=Object.freeze({infer,policy,validateRoute,modalities:Object.freeze([...modalities]),tasks:Object.freeze([...tasks])});
})();