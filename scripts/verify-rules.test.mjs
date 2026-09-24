import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,deleteDoc,collection,getDocs,serverTimestamp,Timestamp,setLogLevel} from 'firebase/firestore';
import {ref,uploadBytes,getMetadata,deleteObject,listAll,updateMetadata,getDownloadURL} from 'firebase/storage';
setLogLevel('silent');
let env;
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-uvenaro-security',firestore:{rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')},storage:{rules:readFileSync(new URL('../storage.rules',import.meta.url),'utf8')}});
});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{await env.clearFirestore();await env.clearStorage();});
const user=(uid,claims={})=>env.authenticatedContext(uid,claims);
const profile=()=>({displayName:'Alice',locale:'hi-IN',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
const project=()=>({ownerId:'alice',name:'My project',type:'image',status:'draft',schemaVersion:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),thumbnailPath:'users/alice/thumb.png'});
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
async function seed(){await env.withSecurityRulesDisabled(async c=>{
 await setDoc(doc(c.firestore(),'users/alice'),{displayName:'Alice',locale:'en',createdAt:Timestamp.fromMillis(1000),updatedAt:Timestamp.fromMillis(1000)});
 await setDoc(doc(c.firestore(),'users/alice/projects/one'),{...project(),createdAt:Timestamp.fromMillis(1000),updatedAt:Timestamp.fromMillis(1000)});
});}
test('owner can create, read and update a valid profile',async()=>{
 const d=doc(user('alice').firestore(),'users/alice');await assertSucceeds(setDoc(d,profile()));await assertSucceeds(getDoc(d));
 await assertSucceeds(updateDoc(d,{displayName:'New name',updatedAt:serverTimestamp()}));
});
test('anonymous and other users cannot read/write a private profile',async()=>{
 await seed();for(const c of [env.unauthenticatedContext(),user('bob'),user('admin',{admin:true})]){
 const d=doc(c.firestore(),'users/alice');await assertFails(getDoc(d));await assertFails(setDoc(d,profile()));await assertFails(deleteDoc(d));
 }
});
test('profile listing and client deletion are forbidden',async()=>{
 await seed();const db=user('alice').firestore();await assertFails(getDocs(collection(db,'users')));await assertFails(deleteDoc(doc(db,'users/alice')));
});
for(const [name,change] of Object.entries({admin:{admin:true},plan:{plan:'premium'},credits:{credits:99999},'wrong name type':{displayName:42},'long name':{displayName:'x'.repeat(121)},'unsafe URL':{photoURL:'javascript:alert(1)'},'invalid locale':{locale:'<script>'},'forged timestamp':{createdAt:Timestamp.fromMillis(1000)}}))test(`profile rejects ${name}`,async()=>{
 await assertFails(setDoc(doc(user('alice').firestore(),'users/alice'),{...profile(),...change}));
});
test('profile creation timestamp cannot be rewritten',async()=>{
 await seed();await assertFails(updateDoc(doc(user('alice').firestore(),'users/alice'),{createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
});
test('owner can create, list, update and delete own project',async()=>{
 const db=user('alice').firestore(),d=doc(db,'users/alice/projects/one');
 await assertSucceeds(setDoc(d,project()));await assertSucceeds(getDoc(d));await assertSucceeds(getDocs(collection(db,'users/alice/projects')));
 await assertSucceeds(updateDoc(d,{name:'Renamed',updatedAt:serverTimestamp()}));await assertSucceeds(deleteDoc(d));
});
test('other users and anonymous callers cannot access projects',async()=>{
 await seed();for(const c of [env.unauthenticatedContext(),user('bob'),user('admin',{admin:true})]){
  const db=c.firestore(),d=doc(db,'users/alice/projects/one');await assertFails(getDoc(d));await assertFails(setDoc(d,project()));await assertFails(deleteDoc(d));await assertFails(getDocs(collection(db,'users/alice/projects')));
 }
});
for(const [name,change] of Object.entries({'wrong owner':{ownerId:'bob'},'empty name':{name:''},'long name':{name:'a'.repeat(201)},'invalid status':{status:'paid'},'wrong schema':{schemaVersion:'1'},'cross-user thumbnail':{thumbnailPath:'users/bob/private.png'},'path traversal':{thumbnailPath:'users/alice/../bob/private.png'},'extra billing field':{credits:100},'forged updated time':{updatedAt:Timestamp.fromMillis(1000)}}))test(`project rejects ${name}`,async()=>{
 await assertFails(setDoc(doc(user('alice').firestore(),'users/alice/projects/one'),{...project(),...change}));
});
test('project creation time cannot be rewritten',async()=>{
 await seed();await assertFails(updateDoc(doc(user('alice').firestore(),'users/alice/projects/one'),{createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
});
for(const path of ['claims/one','claims/one/evidence/one','auditLogs/one','billing_accounts/alice','unknown/one'])test(`${path} is backend-only even for a client admin claim`,async()=>{
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),{private:'value'}));
 for(const c of [env.unauthenticatedContext(),user('alice'),user('admin',{admin:true})]){
  const d=doc(c.firestore(),path);await assertFails(getDoc(d));await assertFails(setDoc(d,{private:'changed'}));await assertFails(deleteDoc(d));
 }
});
test('owner can upload, read metadata, list and delete private media',async()=>{
 const storage=user('alice').storage(),file=ref(storage,'users/alice/image.png');
 await assertSucceeds(uploadBytes(file,png,{contentType:'image/png',customMetadata:{ownerId:'alice'}}));
 await assertSucceeds(getMetadata(file));await assertSucceeds(listAll(ref(storage,'users/alice')));await assertSucceeds(deleteObject(file));
});
test('other users and anonymous callers cannot access private media',async()=>{
 await env.withSecurityRulesDisabled(c=>uploadBytes(ref(c.storage(),'users/alice/image.png'),png,{contentType:'image/png'}));
 for(const c of [env.unauthenticatedContext(),user('bob'),user('admin',{admin:true})]){
  const file=ref(c.storage(),'users/alice/image.png');await assertFails(getMetadata(file));await assertFails(uploadBytes(file,png,{contentType:'image/png'}));await assertFails(deleteObject(file));await assertFails(listAll(ref(c.storage(),'users/alice')));
 }
});
for(const type of ['image/svg+xml','image/x-unknown','text/html','application/javascript','application/octet-stream'])test(`rejects active or unsupported upload type ${type}`,async()=>{
 await assertFails(uploadBytes(ref(user('alice').storage(),'users/alice/file'),png,{contentType:type}));
});
test('empty uploads and oversize uploads are rejected',async()=>{
 const file=ref(user('alice').storage(),'users/alice/file.png');
 await assertFails(uploadBytes(file,new Uint8Array(),{contentType:'image/png'}));
 await assertFails(uploadBytes(file,new Uint8Array(100*1024*1024+1),{contentType:'image/png'}));
});
test('owner cannot forge ownership or arbitrary custom metadata',async()=>{
 const file=ref(user('alice').storage(),'users/alice/file.png');
 await assertFails(uploadBytes(file,png,{contentType:'image/png',customMetadata:{ownerId:'bob'}}));
 await assertFails(uploadBytes(file,png,{contentType:'image/png',customMetadata:{public:'true'}}));
});
test('metadata update cannot turn private media into active SVG',async()=>{
 const file=ref(user('alice').storage(),'users/alice/file.png');
 await assertSucceeds(uploadBytes(file,png,{contentType:'image/png'}));
 await assertFails(updateMetadata(file,{contentType:'image/svg+xml'}));
});
for(const path of ['evidence/file.png','public/file.png','unknown/file.png'])test(`storage ${path} is backend-only`,async()=>{
 for(const c of [env.unauthenticatedContext(),user('alice'),user('admin',{admin:true})])await assertFails(uploadBytes(ref(c.storage(),path),png,{contentType:'image/png'}));
});

test('Firebase token URLs are bearer access, a documented boundary before cloud activation',async()=>{
 const file=ref(user('alice').storage(),'users/alice/token-boundary.png');
 await assertSucceeds(uploadBytes(file,png,{contentType:'image/png',customMetadata:{firebaseStorageDownloadTokens:'test-only-bearer'}}));
 const url=await getDownloadURL(file);
 // Firebase strips this reserved field before custom-metadata rules evaluate.
 // Never treat a token download URL as UID-protected API access.
 const response=await fetch(url);
 assert.equal(response.status,200);
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);
});
