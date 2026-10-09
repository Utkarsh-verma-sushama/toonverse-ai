import test from 'node:test';
import assert from 'node:assert/strict';
import {
 PROVIDER_EVIDENCE_DIGEST_ALGORITHM,
 PROVIDER_EVIDENCE_INTEGRITY_PROTOCOL,
 canonicalizeEvidence,
 createEvidenceDigest,
 evidenceIntegrityShape,
 verifyEvidenceDigest
} from '../backend/provider-evidence-integrity.mjs';

const sample={
 z:1,
 nested:{answer:'redacted',prompt:'redacted'},
 a:[3,2,1]
};

test('canonical evidence ordering is deterministic',()=>{
 assert.equal(canonicalizeEvidence({b:2,a:1}),canonicalizeEvidence({a:1,b:2}));
});

test('sha-256 evidence digest detects tampering',async()=>{
 const digest=await createEvidenceDigest(sample);
 assert.match(digest,/^[a-f0-9]{64}$/);
 assert.equal(await verifyEvidenceDigest(sample,digest),true);
 assert.equal(await verifyEvidenceDigest({...sample,z:2},digest),false);
});

test('integrity shape fails closed unless verified digest is present',()=>{
 assert.deepEqual(evidenceIntegrityShape({}),{protocol:false,algorithm:false,verified:false,digest:false});
 assert.equal(evidenceIntegrityShape({
  protocol:PROVIDER_EVIDENCE_INTEGRITY_PROTOCOL,
  algorithm:PROVIDER_EVIDENCE_DIGEST_ALGORITHM,
  verified:true,
  digest:'a'.repeat(64)
 }).digest,true);
});
