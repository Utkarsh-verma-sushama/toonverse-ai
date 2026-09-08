(()=>{"use strict";const $=id=>document.getElementById(id),checks=[
["qa","Quality suite","qa.html","Run 163/163 regression checks"],
["privacy","Privacy policy","privacy.html","Verify against real data flows and processors"],
["terms","Terms of Use","terms.html","Obtain jurisdiction-specific legal approval"],
["stores","Store metadata","store-assets/store-listing.json","Finalize native bundle IDs, pricing and screenshots"],
["android","Google Play","https://support.google.com/googleplay/android-developer/answer/10787469","Complete Data safety, content rating, app access and testing track"],
["apple","Apple App Store","https://developer.apple.com/app-store/review/guidelines/","Complete App Privacy, review notes, age rating and TestFlight"],
["soft","Soft launch","support.html","Invite a limited consented cohort and monitor incidents"]
];let state=JSON.parse(localStorage.getItem("toonverse-launch-readiness")||"{}");
function render(){const list=$("gates");list.innerHTML=checks.map(x=>'<article class="gate"><label><input type="checkbox" data-id="'+x[0]+'" '+(state[x[0]]?"checked":"")+'> <strong>'+x[1]+'</strong></label><p>'+x[3]+'</p><a href="'+x[2]+'" '+(x[2].startsWith("http")?'target="_blank" rel="noopener noreferrer"':"")+'">Open requirement</a></article>').join("");list.querySelectorAll("input").forEach(i=>i.onchange=()=>{state[i.dataset.id]=i.checked;localStorage.setItem("toonverse-launch-readiness",JSON.stringify(state));summary()});summary()}
function summary(){const done=checks.filter(x=>state[x[0]]).length;$("progress").value=done;$("progress").max=checks.length;$("summary").textContent=done+" of "+checks.length+" launch gates acknowledged. Checking a gate records readiness review; it does not claim store approval or a completed external action."}
$("reset").onclick=()=>{if(confirm("Clear only this device’s launch-readiness checklist?")){state={};localStorage.removeItem("toonverse-launch-readiness");render()}};
$("campaign").onsubmit=e=>{e.preventDefault();const plan={goal:$("goal").value.trim().slice(0,240),audience:$("audience").value.trim().slice(0,240),message:$("message").value.trim().slice(0,500),channels:[...document.querySelectorAll("[name=channel]:checked")].map(x=>x.value),budget:$("budget").value,createdAt:new Date().toISOString(),status:"draft"};localStorage.setItem("toonverse-campaign-draft",JSON.stringify(plan));$("campaignStatus").textContent="Campaign brief saved locally as a draft. Nothing was published or purchased."};
render()})();