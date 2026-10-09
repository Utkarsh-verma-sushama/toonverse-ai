const freeze=Object.freeze;

export const PROVIDER_EVIDENCE_INTEGRITY_PROTOCOL='uvenaro-provider-evidence-integrity-v1';
export const PROVIDER_EVIDENCE_DIGEST_ALGORITHM='SHA-256';

function normalize(value){
 if(Array.isArray(value))return value.map(normalize);
 if(value&&typeof value==='object'){
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])]));
 }
 return value;
}

export function canonicalizeEvidence(value){
 return JSON.stringify(normalize(value));
}

export async function createEvidenceDigest(value){
 const bytes=new TextEncoder().encode(canonicalizeEvidence(value));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function verifyEvidenceDigest(value,digest){
 if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))return false;
 const actual=await createEvidenceDigest(value);
 return actual===digest;
}

export function evidenceIntegrityShape(record={}){
 return {
  protocol:record.protocol===PROVIDER_EVIDENCE_INTEGRITY_PROTOCOL,
  algorithm:record.algorithm===PROVIDER_EVIDENCE_DIGEST_ALGORITHM,
  verified:record.verified===true,
  digest:typeof record.digest==='string'&&/^[a-f0-9]{64}$/.test(record.digest)
 };
}

export function requireEvidenceIntegrityShape(record={}){
 const shape=evidenceIntegrityShape(record);
 if(!Object.values(shape).every(Boolean))throw new Error('EVIDENCE_INTEGRITY_REQUIRED');
 return freeze({...shape});
}
