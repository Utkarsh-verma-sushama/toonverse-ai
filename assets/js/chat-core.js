(() => {
  'use strict';
  const MAX_MESSAGES=200,MAX_CONTEXT_CHARS=12000;
  let current=null,active=null;
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
  function assertCurrent(op){
    if(op.accountChanged||op.accountOwner!==null&&owner()!==op.accountOwner)throw error('Your account changed. Open chat again for the current account.','ACCOUNT_CHANGED');
    if(op.controller.signal.aborted)throw error(op.stopped?
      'Stopped waiting. The request may still finish and use credits. Check its status before sending again.':
      'The connection ended before the result was confirmed. Check this request’s status before sending again.',op.stopped?'REQUEST_STOPPED':'OUTCOME_UNKNOWN');
  }
  async function run(kind,work){
    if(active)throw error('A request is already in progress.','REQUEST_IN_PROGRESS');
    const initialOwner=owner();
    const op=active={kind,controller:new AbortController(),state:null,accountOwner:initialOwner==='guest'?null:initialOwner,stopped:false,accountChanged:false,timer:null};
    try{
      if(window.UvenaroAuth?.restore)await window.UvenaroAuth.restore();
      assertCurrent(op);op.state=store();op.accountOwner=op.state.owner;
      return await work(op);
    }finally{clearTimeout(op.timer);if(active===op)active=null;}
  }
  async function tokenFor(op){
    const value=await window.UvenaroAuth?.getAccessToken?.().catch(()=> '');
    assertCurrent(op);
    if(!value||op.state.owner==='guest')throw error('Please sign in before using AI chat.','UNAUTHORIZED');
    return value;
  }
  async function readResponse(op,url,options,timeout){
    op.timer=setTimeout(()=>op.controller.abort(),timeout);
    try{
      const response=await fetch(url,{...options,credentials:'include',cache:'no-store',redirect:'error',signal:op.controller.signal});
      assertCurrent(op);
      const body=await response.json();
      assertCurrent(op);return {response,body};
    }catch(e){
      assertCurrent(op);
      throw error('The result could not be confirmed. Check this request’s status before sending again.','OUTCOME_UNKNOWN');
    }
  }
  async function transmit(op){
    if(!connected())throw error('The AI service is not enabled yet.','CHAT_EXECUTION_DISABLED');
    const state=op.state,token=await tokenFor(op),pending=state.pending;
    save(state); // Persist the same request key/body before any possible paid call.
    assertCurrent(op);
    const {response,body}=await readResponse(op,`${endpoint()}/v1/chat/responses`,{method:'POST',
      headers:{'Content-Type':'application/json','Idempotency-Key':pending.id,
        // A fresh transport nonce on each retry; the durable billing key stays unchanged.
        'X-Uvenaro-Nonce':crypto.randomUUID(),Authorization:`Bearer ${token}`},body:JSON.stringify(pending.body)},60000);
    if(!response.ok){
      if(definiteRejection.has(body?.code)){state.pending=null;save(state);}
      throw error(messagesForCode[body?.code]||'The request could not be confirmed. Check its status before retrying.',body?.code||'OUTCOME_UNKNOWN');
    }
    if(typeof body?.output!=='string'||!body.output)throw error('The reply could not be confirmed. Check the request status.','OUTCOME_UNKNOWN');
    const assistant={id:String(body.id||crypto.randomUUID()),role:'assistant',content:body.output,createdAt:new Date().toISOString(),usage:body.usage||null};
    state.messages.push(assistant);state.pending=null;save(state);
    return {assistant,accountChanged:false};
  }
  async function send(content){
    return run('send',async op=>{
      const text=String(content||'').trim();if(!text||text.length>12000)throw error('Message must contain 1 to 12,000 characters.');
      const state=op.state;
      if(state.pending){
        if(state.pending.body.message!==text)throw error('Check the previous request before starting a new one.','REQUEST_PENDING');
        return transmit(op);
      }
      const user={id:crypto.randomUUID(),role:'user',content:text,createdAt:new Date().toISOString()};
      state.messages.push(user);
      if(!connected()){save(state);return {user,assistant:null,unavailable:true};}
      state.pending={id:user.id,body:{message:text,conversation:context(state.messages)}};
      save(state);return {user,...await transmit(op)};
    });
  }
  async function retry(){return run('send',op=>{
    if(!op.state.pending)throw error('There is no pending request.');return transmit(op);
  });}
  async function checkPending(){return run('receipt',async op=>{
    const state=op.state;if(!state.pending)return null;
    const pendingId=state.pending.id,token=await tokenFor(op);
    const {response,body:result}=await readResponse(op,`${endpoint()}/v1/chat/requests/${encodeURIComponent(pendingId)}`,
      {headers:{Authorization:`Bearer ${token}`}},15000);
    // A proxy/route 404 is not proof that the billing reservation is absent.
    if(response.status===404&&result?.code==='RESERVATION_NOT_FOUND')return {status:'not_found',credits:0};
    if(!response.ok)throw error('Request status is unavailable. Please check again.');
    if(!['reserved','settled','released'].includes(result?.status))throw error('The request status could not be confirmed.');
    if(['settled','released'].includes(result.status)){
      const message=state.messages.find(m=>m.id===pendingId);
      if(message&&result.status==='settled'){message.delivery='reply_unavailable';message.usage={credits:result.credits,inputTokens:result.inputTokens,outputTokens:result.outputTokens};}
      state.pending=null;save(state);
    }
    return {...result,accountChanged:false};
  });}
  function cancel(){
    if(!active||active.kind!=='send'||active.stopped)return false;
    active.stopped=true;active.controller.abort();return true;
  }
  // Bind operations to this sign-in lifetime, including logout then login as the
  // same person. A late private reply must never be stored or shown afterward.
  window.addEventListener?.('uvenaro:auth-change',()=>{
    if(active&&active.accountOwner!==null&&owner()!==active.accountOwner){active.accountChanged=true;active.controller.abort();}
  });
  function clear(){const state=store();if(active||state.pending)throw error('Check the pending request before clearing this chat.','REQUEST_PENDING');state.messages=[];save(state);}
  window.UvenaroChat=Object.freeze({connected,send,retry,checkPending,cancel,clear,
    pending:()=>Boolean(store().pending),messages:()=>store().messages.map(x=>({...x}))});
})();
