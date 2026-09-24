import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { consumeReplayNonce, cleanupReplayNonces, ReplayError } from "../backend/replay-guard.mjs";

const migration=readFileSync(new URL("../backend/migrations/0004_request_replay_guard.sql",import.meta.url),"utf8");
function env(){
 const sql=new DatabaseSync(":memory:");sql.exec(migration);
 const DB={prepare(q){let v=[];return{bind(...x){v=x;return this;},async run(){const r=sql.prepare(q).run(...v);return{meta:{changes:Number(r.changes)}};}}}};
 return {sql,DB,REPLAY_PROTECTION_ENABLED:"true"};
}
const user={sub:"alice"}, nonce="abcdefghijklmnopqrstuvwxyzABCDEFG_123456";
const req=value=>new Request("https://api.uvenaro.invalid/v1/chat/responses",{headers:value?{"x-uvenaro-nonce":value}:{}});
const is=code=>e=>e instanceof ReplayError&&e.code===code;

test("missing and malformed replay nonces fail before storage",async()=>{
 const e=env();try{
  await assert.rejects(consumeReplayNonce(e,user,req(),"chat"),is("VALID_REQUEST_NONCE_REQUIRED"));
  for(const value of ["short","contains space".repeat(3),"x".repeat(129)])
   await assert.rejects(consumeReplayNonce(e,user,req(value),"chat"),is("VALID_REQUEST_NONCE_REQUIRED"));
  assert.equal(e.sql.prepare("SELECT COUNT(*) n FROM request_nonces").get().n,0);
 }finally{e.sql.close();}
});
test("a nonce is accepted once and an exact replay is rejected",async()=>{
 const e=env();try{
  assert.deepEqual(await consumeReplayNonce(e,user,req(nonce),"chat"),{enforced:true});
  await assert.rejects(consumeReplayNonce(e,user,req(nonce),"chat"),is("REQUEST_REPLAY_DETECTED"));
  assert.equal(e.sql.prepare("SELECT COUNT(*) n FROM request_nonces").get().n,1);
  assert.notEqual(e.sql.prepare("SELECT nonce_hash FROM request_nonces").get().nonce_hash,nonce);
 }finally{e.sql.close();}
});
test("nonce scope is bound to owner and operation purpose",async()=>{
 const e=env();try{
  await consumeReplayNonce(e,user,req(nonce),"chat");
  await consumeReplayNonce(e,{sub:"bob"},req(nonce),"chat");
  await consumeReplayNonce(e,user,req(nonce),"agent");
  assert.equal(e.sql.prepare("SELECT COUNT(*) n FROM request_nonces").get().n,3);
 }finally{e.sql.close();}
});
test("missing replay migration fails closed when enforcement is enabled",async()=>{
 const sql=new DatabaseSync(":memory:");
 const DB={prepare(q){let v=[];return{bind(...x){v=x;return this;},async run(){return sql.prepare(q).run(...v);}}}};
 try{await assert.rejects(consumeReplayNonce({DB,REPLAY_PROTECTION_ENABLED:"true"},user,req(nonce),"chat"),is("REPLAY_PROTECTION_NOT_READY"));}finally{sql.close();}
});
test("disabled staged rollout never consumes a nonce",async()=>{
 assert.deepEqual(await consumeReplayNonce({REPLAY_PROTECTION_ENABLED:"false"},user,req(),"chat"),{enforced:false});
});

test("simultaneous duplicate nonce permits exactly one request",async()=>{
 const e=env();try{
  const outcomes=await Promise.allSettled(Array.from({length:8},()=>consumeReplayNonce(e,user,req(nonce),"chat")));
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(outcomes.filter(x=>x.status==="rejected"&&is("REQUEST_REPLAY_DETECTED")(x.reason)).length,7);
  assert.equal(e.sql.prepare("SELECT COUNT(*) n FROM request_nonces").get().n,1);
 }finally{e.sql.close();}
});
test("scheduled cleanup removes only expired replay nonces",async()=>{
 const e=env();try{
  const created=new Date(Date.now()-11*60*1000).toISOString(),expired=new Date(Date.now()-10*60*1000).toISOString();
  const liveCreated=new Date().toISOString(),future=new Date(Date.now()+5*60*1000).toISOString();
  e.sql.prepare("INSERT INTO request_nonces(owner_id,nonce_hash,purpose,created_at,expires_at) VALUES(?,?,?,?,?)").run("alice","a".repeat(64),"chat",created,expired);
  e.sql.prepare("INSERT INTO request_nonces(owner_id,nonce_hash,purpose,created_at,expires_at) VALUES(?,?,?,?,?)").run("alice","b".repeat(64),"chat",liveCreated,future);
  await cleanupReplayNonces(e);
  const rows=e.sql.prepare("SELECT nonce_hash FROM request_nonces ORDER BY nonce_hash").all();
  assert.deepEqual(rows.map(x=>x.nonce_hash),["b".repeat(64)]);
 }finally{e.sql.close();}
});
