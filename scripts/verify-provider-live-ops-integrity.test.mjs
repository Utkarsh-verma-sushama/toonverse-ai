import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evidenceIntegrityShape} from '../backend/provider-evidence-integrity.mjs';

const bundle=JSON.parse(readFileSync(new URL('../deploy/provider-acceptance/live-operations-review.json',import.meta.url),'utf8'));

test('live operations ledger has an explicit unverified integrity state',()=>{
 const shape=evidenceIntegrityShape(bundle.integrity);
 assert.equal(shape.verified,false);
 assert.equal(shape.digest,false);
 assert.equal(bundle.decision.status,'SAFE_OFF_PENDING');
});
