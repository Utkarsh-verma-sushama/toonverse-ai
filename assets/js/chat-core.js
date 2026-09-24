(() => {
  'use strict';
  const MAX_MESSAGES=200,MAX_CONTEXT_CHARS=12000;
  let current=null,busy=false;
  const owner=()=>String(window.UvenaroAuth?.getState?.().user?.id||'guest');
  const error=(message,code='CHAT_ERROR')=>Object.assign(new Error(message),{code});
  function store(){
    const uid=owner();if(current?.owner===uid)return current;
    const key=`uvenaro.chat.v2:${encodeURIComponent(uid)}`;let data;
    try{data=JSON.parse(localStorage.getItem(key)||(uid==='guest'?localStorage.getItem('uvenaro.chat.v1'):null)||'{}');}catch{data={};}
    const messages=Array.isArray(data?.messages)?data.messages.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.id==='string'&&typeof m.content==='string').slice(-MAX_MESSAGES):[];
    const pending=data?.pending&&typeof data.pending.id==='string'&&typeof data.pending.body?.message==='string'&&Array.isArray(data.pending.body?.conversation)?data.pending:null;
    return current={owner:uid,key,messages,pending};
  }
  function save(state){
    try{localStorage.setItem(state.key,JSON.stringify({messages:state.messages.slice(-MAX_MESSAGES),pending:state.pending}));}
    catch{throw error('Chat could not be saved on this device. Free some storage before sending.','LOCAL_STORAGE_UNAVAILABLE');}
  }
  const endpoint=()=>String(window.UvenaroConfig?.services?.apiBaseUrl||'').replace(/\/$/,'');
  const connected=()=>Boolean(endpoint()&&window.UvenaroConfig?.features?.chatCore);
  function context(messages){
    const items=[];let size=0;
    for(const item of messages.slice(-40).reverse()){
      if(size+item.content.length>MAX_CONTEXT_CHARS)break;
      items.unshift({role:item.role,content:item.content});size+=item.content.length;
    }
    return items;
  }
  const messagesForCode={
    INSUFFICIENT_CREDITS:'There are not enough available credits for this request.',
    DAILY_QUOTA_REACHED:'Your daily AI allowance has been reached.',
    MONTHLY_QUOTA_REACHED:'Your current billing-cycle AI allowance has been reached.',
    RATE_LIMIT_REACHED:'Too many requests were sent. Please try again shortly.',
    ACTIVE_SUBSCRIPTION_REQUIRED:'Your account needs an active AI allowance.',
    REQUEST_COST_LIMIT_EXCEEDED:'This request exceeds your plan’s per-request limit.',
    GLOBAL_SPEND_CEILING_REACHED:'AI requests are temporarily paused. No new credits were charged.',
    PROVIDER_REJECTED:'The AI service could not accept this request. No credits were charged.',
    RECONCILIATION_REQUIRED:'The previous request is being checked. Credits may remain reserved. Check its status before sending again.',
    REQUEST_ALREADY_EXISTS:'This request has already been received. Check its status before sending again.',
    IDEMPOTENCY_REPLAY:'This request has already completed. Check its credit receipt.',
    UNAUTHORIZED:'Please sign in again before sending.',
    CHAT_EXECUTION_DISABLED:'The AI service is currently disabled. Check the previous request’s status if its outcome is unknown.'
  };
  const definiteRejection=new Set(['INSUFFICIENT_CREDITS','DAILY_QUOTA_REACHED','MONTHLY_QUOTA_REACHED','RATE_LIMIT_REACHED',
    'ACTIVE_SUBSCRIPTION_REQUIRED','REQUEST_COST_LIMIT_EXCEEDED','GLOBAL_SPEND_CEILING_REACHED','PROVIDER_REJECTED',
    'BILLING_DISABLED','PRICE_SNAPSHOT_REQUIRED','USAGE_TEMPORARILY_BLOCKED',
    'INVALID_MESSAGE','INVALID_CONVERSATION','CONVERSATION_LIMIT_EXCEEDED','VALID_IDEMPOTENCY_KEY_REQUIRED']);
  async function tokenFor(state){
    const value=await window.UvenaroAuth?.getAccessToken?.().catch(()=> '');
    if(!value||state.owner==='guest')throw error('Please sign in before using AI chat.','UNAUTHORIZED');
    if(owner()!==state.owner)throw error('Your account changed. Open chat again for the current account.','ACCOUNT_CHANGED');
    return value;
  }
  async function transmit(state){
    if(busy)throw error('A request is already in progress.','REQUEST_IN_PROGRESS');
    if(!connected())throw error('The AI service is not enabled yet.','CHAT_EXECUTION_DISABLED');
    busy=true;let timer;
    try{
      const token=await tokenFor(state);const pending=state.pending;
      save(state); // The same request key and body must survive a reload before any paid call.
      const controller=new AbortController();timer=setTimeout(()=>controller.abort(),60000);
      let response;
      try{response=await fetch(`${endpoint()}/v1/chat/responses`,{method:'POST',credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json','Idempotency-Key':pending.id,Authorization:`Bearer ${token}`},body:JSON.stringify(pending.body)});}
      catch{throw error('The connection ended before the result was confirmed. Check this request’s status before sending again.','OUTCOME_UNKNOWN');}
      const body=await response.json().catch(()=>({}));
      if(!response.ok){
        if(definiteRejection.has(body.code)){state.pending=null;save(state);}
        throw error(messagesForCode[body.code]||'The request could not be confirmed. Check its status before retrying.',body.code||'OUTCOME_UNKNOWN');
      }
      if(typeof body.output!=='string'||!body.output)throw error('The reply could not be confirmed. Check the request status.','OUTCOME_UNKNOWN');
      const assistant={id:String(body.id||crypto.randomUUID()),role:'assistant',content:body.output,createdAt:new Date().toISOString(),usage:body.usage||null};
      state.messages.push(assistant);state.pending=null;save(state);
      return {assistant,accountChanged:owner()!==state.owner};
    }finally{clearTimeout(timer);busy=false;}
  }
  async function send(content){
    if(busy)throw error('A request is already in progress.','REQUEST_IN_PROGRESS');
    if(connected()&&window.UvenaroAuth?.restore){await window.UvenaroAuth.restore();if(busy)throw error('A request is already in progress.','REQUEST_IN_PROGRESS');}
    const text=String(content||'').trim();if(!text||text.length>12000)throw error('Message must contain 1 to 12,000 characters.');
    const state=store();
    if(state.pending){
      if(state.pending.body.message!==text)throw error('Check the previous request before starting a new one.','REQUEST_PENDING');
      return transmit(state); // Retry the original body/key, never mint a fresh paid request.
    }
    const user={id:crypto.randomUUID(),role:'user',content:text,createdAt:new Date().toISOString()};
    state.messages.push(user);
    if(!connected()){save(state);return {user,assistant:null,unavailable:true};}
    state.pending={id:user.id,body:{message:text,conversation:context(state.messages)}};
    save(state);return {user,...await transmit(state)};
  }
  async function retry(){const state=store();if(!state.pending)throw error('There is no pending request.');return transmit(state);}
  async function checkPending(){
    if(busy)throw error('Wait for the current request to finish.','REQUEST_IN_PROGRESS');
    const state=store();if(!state.pending)return null;
    busy=true;let timer;const pendingId=state.pending.id;
    try{
      const token=await tokenFor(state);const controller=new AbortController();timer=setTimeout(()=>controller.abort(),15000);
      const response=await fetch(`${endpoint()}/v1/chat/requests/${encodeURIComponent(pendingId)}`,{headers:{Authorization:`Bearer ${token}`},credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal});
      if(response.status===404)return {status:'not_found',credits:0};
      const result=await response.json();if(!response.ok)throw error('Request status is unavailable. Please check again.');
      if(!['reserved','settled','released'].includes(result.status))throw error('The request status could not be confirmed.');
      if(['settled','released'].includes(result.status)){
        const message=state.messages.find(m=>m.id===pendingId);
        if(message&&result.status==='settled'){message.delivery='reply_unavailable';message.usage={credits:result.credits,inputTokens:result.inputTokens,outputTokens:result.outputTokens};}
        state.pending=null;save(state);
      }
      return {...result,accountChanged:owner()!==state.owner};
    }finally{clearTimeout(timer);busy=false;}
  }
  function clear(){const state=store();if(busy||state.pending)throw error('Check the pending request before clearing this chat.','REQUEST_PENDING');state.messages=[];save(state);}
  window.UvenaroChat=Object.freeze({connected,send,retry,checkPending,clear,
    pending:()=>Boolean(store().pending),messages:()=>store().messages.map(x=>({...x}))});
})();
