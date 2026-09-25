import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRemoteFailure,safeWranglerFailure} from './deploy-account-staging.mjs';

test('classifies remote D1 permission failures without exposing provider output',()=>{
 const secret='cf-secret-token-value';
 const error=safeWranglerFailure('Remote migration preflight',{status:1,stderr:`Forbidden: permission denied token=${secret}`});
 assert.match(error.message,/permission\/authentication/);
 assert.doesNotMatch(error.message,new RegExp(secret));
 assert.doesNotMatch(error.message,/Forbidden|permission denied token=/);
});

test('classifies duplicate schema as migration-state mismatch without raw SQL',()=>{
 const raw='SQLITE_ERROR: duplicate column name: request_hash; ALTER TABLE usage_reservations ADD COLUMN request_hash TEXT';
 const error=safeWranglerFailure('Tracked database migration',{status:1,stderr:raw});
 assert.match(error.message,/schema already exists \/ migration-state mismatch/);
 assert.doesNotMatch(error.message,/request_hash|ALTER TABLE|SQLITE_ERROR/);
});

test('classifies migration tracking and remote network failures',()=>{
 assert.equal(classifyRemoteFailure('D1 migrations table state is inconsistent'),'migration tracking/state');
 assert.equal(classifyRemoteFailure('fetch failed: network timeout'),'remote service/network');
});

test('unknown and spawn failures remain fail-closed and secret-safe',()=>{
 const unknown=safeWranglerFailure('Tracked database migration',{status:1,stderr:'unexpected opaque provider response'});
 assert.match(unknown.message,/unclassified remote failure/);
 const spawn=safeWranglerFailure('Tracked database migration',{error:new Error('spawn ETIMEDOUT /tmp/secret-file')});
 assert.match(spawn.message,/remote service\/network/);
 assert.doesNotMatch(spawn.message,/\/tmp\/secret-file/);
});
