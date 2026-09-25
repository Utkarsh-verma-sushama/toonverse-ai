import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRemoteFailure,safeWranglerFailure,reconciliationDecision} from './deploy-account-staging.mjs';

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

test('reconciles only a complete known schema fingerprint',()=>{
 const names=['account_profiles','account_sessions','account_access_tokens','account_refresh_tokens','account_security_events','account_rate_limits','account_challenges','account_deletion_requests','idx_account_sessions_owner','idx_account_access_expiry','idx_account_refresh_session','idx_account_security_owner','idx_account_rate_expiry','idx_account_deletion_pending','account_security_no_update'];
 assert.deepEqual(reconciliationDecision({pending:['0002_account_sessions.sql'],objects:names.map(name=>({name}))}),[{migration:'0002_account_sessions.sql',action:'reconcile'}]);
});

test('allows normal apply when known migration schema is absent',()=>{
 assert.deepEqual(reconciliationDecision({pending:['0002_account_sessions.sql'],objects:[]}),[{migration:'0002_account_sessions.sql',action:'apply'}]);
});

test('fails closed when known migration schema is only partially present',()=>{
 assert.throws(()=>reconciliationDecision({pending:['0002_account_sessions.sql'],objects:[{name:'account_profiles'}]}),/Partial staging schema detected/);
});

test('does not auto-reconcile an unknown migration fingerprint',()=>{
 assert.deepEqual(reconciliationDecision({pending:['9999_unknown.sql'],objects:[{name:'account_profiles'}]}),[{migration:'9999_unknown.sql',action:'apply'}]);
});
