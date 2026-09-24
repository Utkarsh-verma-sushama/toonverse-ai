import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {d1,alice,cfg,messages} from './billing-fixtures.mjs';
import {reserveChat} from '../backend/chat-billing.mjs';
const sql=new DatabaseSync(workerData.file);sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
const barrier=new Int32Array(workerData.barrier);parentPort.postMessage({ready:true});Atomics.wait(barrier,0,0);
const env={DB:d1(sql)},outcomes=[];
for(let i=0;i<8;i++){
 try{await reserveChat(env,alice,workerData.duplicate?'same-key':`worker-${workerData.index}-${i}`,messages,cfg);outcomes.push('accepted');}
 catch(error){outcomes.push(error.code||error.message);}
}
sql.close();parentPort.postMessage({outcomes});
