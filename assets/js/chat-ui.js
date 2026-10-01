(() => {
 'use strict';
 const chat=window.UvenaroChat,$=id=>document.getElementById(id);
 const log=$('log'),input=$('input'),send=$('send'),stop=$('stop-request'),check=$('check-request'),retry=$('retry-request');
 const owner=()=>window.UvenaroAuth?.getState?.().user?.id||'guest';
 let currentOwner=owner();
 function render(){
  log.textContent='';
  for(const message of chat.messages()){
   const item=document.createElement('div');item.className='msg '+message.role;item.textContent=message.content;
   if(message.delivery==='reply_unavailable'){
    const receipt=document.createElement('small');receipt.textContent=`\nCompleted: ${message.usage?.credits??0} credits. Reply unavailable on this device.`;item.append(receipt);
   }
   log.append(item);
  }
  log.scrollTop=log.scrollHeight;check.hidden=retry.hidden=!chat.pending();
 }
 function notice(text){$('request-status').textContent=text;}
 function busy(value,canStop=false){
  send.disabled=check.disabled=retry.disabled=$('clear').disabled=value;
  input.disabled=value;stop.hidden=!value||!canStop;stop.disabled=false;
  $('form').setAttribute('aria-busy',String(value));
 }
 async function perform(work,{sending=false}={}){
  busy(true,sending);notice('');
  try{return await work();}
  catch(error){if(error.code!=='ACCOUNT_CHANGED')notice(error.message);}
  finally{render();busy(false);}
 }
 $('service').textContent=chat.connected()?'AI requests use your available credits and plan allowance.':
  'Production AI service is not connected. Messages remain on this device and no paid request is sent.';
 $('form').onsubmit=event=>{
  event.preventDefault();if(send.disabled)return;
  const text=input.value;
  void perform(async()=>{
   const out=await chat.send(text);input.value='';
   if(out.unavailable)notice('AI backend is not connected yet. Your message was saved locally without provider cost.');
  },{sending:true});
 };
 retry.onclick=()=>void perform(()=>chat.retry(),{sending:true});
 stop.onclick=()=>{
  if(chat.cancel()){stop.disabled=true;notice('Stopped waiting. The request may still finish and use credits. Check its status before sending again.');}
 };
 check.onclick=()=>void perform(async()=>{
  const result=await chat.checkPending();if(!result||result.accountChanged)return;
  notice(result.status==='settled'?`The previous request completed and used ${result.credits} credits. Its reply could not be restored on this device.`:
   result.status==='released'?'The previous request was not charged. You can send a new message.':
   result.status==='not_found'?'No saved request was found. You can retry the last request safely.':
   'The previous request is still pending. Its credits remain reserved.');
 });
 $('clear').onclick=()=>{try{if(confirm('Clear local chat history?')){chat.clear();render();notice('');}}catch(error){notice(error.message);}};
 window.addEventListener('uvenaro:auth-change',()=>{
  if(owner()!==currentOwner){currentOwner=owner();input.value='';notice('');}
  render();
 });
 render();
 void window.UvenaroAuth?.restore?.().then(render).catch(()=>{});
})();
