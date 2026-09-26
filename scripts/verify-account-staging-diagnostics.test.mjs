import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRemoteFailure,safeWranglerFailure,reconciliationDecision,pendingMigrationNames,wranglerRows,migrationHistoryNames,safeTrackingReconciliationSql,baselineColumnParity,reconciledMigrationColumns} from './deploy-account-staging.mjs';

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

test('rejects non-contiguous and unknown remote migration history',()=>{
 const local=['0000_baseline.sql','0001_atomic_chat_billing.sql','0002_account_sessions.sql'];
 assert.throws(()=>pendingMigrationNames(local,['0000_baseline.sql','0002_account_sessions.sql']),/non-contiguous/);
 assert.throws(()=>pendingMigrationNames(local,['0000_baseline.sql','9999_unknown.sql']),/unknown migration/);
});

test('accepts only strict successful Wrangler D1 JSON result envelopes',()=>{
 assert.deepEqual(wranglerRows([{success:true,results:[{name:'account_profiles'}]}]),[{name:'account_profiles'}]);
 assert.throws(()=>wranglerRows([{success:false,results:[]}]),/unexpected shape/);
 assert.throws(()=>wranglerRows([{success:true}]),/unexpected shape/);
});

test('rejects malformed or duplicate migration history rows',()=>{
 assert.deepEqual(migrationHistoryNames([{id:1,name:'0000_baseline.sql'},{id:2,name:'0001_atomic_chat_billing.sql'}]),['0000_baseline.sql','0001_atomic_chat_billing.sql']);
 assert.throws(()=>migrationHistoryNames([{id:'1',name:'0000_baseline.sql'}]),/malformed/);
 assert.throws(()=>migrationHistoryNames([{id:1,name:'0000_baseline.sql'},{id:2,name:'0000_baseline.sql'}]),/duplicate names/);
});

test('builds atomic idempotent tracking reconciliation only for a contiguous verified prefix',()=>{
 const local=['0000_baseline.sql','0001_atomic_chat_billing.sql','0002_account_sessions.sql'];
 const sql=safeTrackingReconciliationSql([{migration:'0002_account_sessions.sql',action:'reconcile'}],local,['0000_baseline.sql','0001_atomic_chat_billing.sql']);
 assert.match(sql,/^BEGIN IMMEDIATE;/);
 assert.match(sql,/INSERT INTO d1_migrations/);
 assert.match(sql,/WHERE NOT EXISTS/);
 assert.match(sql,/0002_account_sessions\.sql/);
 assert.match(sql,/COMMIT;$/);
});

test('tracking reconciliation is a no-op without reconcile decisions',()=>{
 assert.equal(safeTrackingReconciliationSql([{migration:'0002_account_sessions.sql',action:'apply'}],['0002_account_sessions.sql'],[]),null);
});

test('tracking reconciliation rejects non-prefix, already-applied and unsafe names',()=>{
 const local=['0000_baseline.sql','0001_atomic_chat_billing.sql','0002_account_sessions.sql'];
 assert.throws(()=>safeTrackingReconciliationSql([{migration:'0002_account_sessions.sql',action:'reconcile'}],local,['0000_baseline.sql']),/contiguous migration prefix/);
 assert.throws(()=>safeTrackingReconciliationSql([{migration:'0000_baseline.sql',action:'reconcile'}],local,['0000_baseline.sql']),/Unsafe migration reconciliation request/);
 assert.throws(()=>safeTrackingReconciliationSql([{migration:'../evil.sql',action:'reconcile'}],local,[]),/Unsafe migration reconciliation request/);
});


test('baseline parity permits only columns owned by a fully reconciled migration',()=>{
 const base={
  billing_accounts:['owner_id','plan_id','status','included_credits','prepaid_credits','reserved_credits','cycle_started_at','cycle_ends_at','updated_at'],
  usage_reservations:['id','owner_id','idempotency_key','feature','estimated_credits','actual_credits','estimated_cost_microusd','actual_cost_microusd','status','created_at','settled_at'],
  usage_limits:['owner_id','daily_credit_limit','monthly_credit_limit','max_request_cost_microusd','requests_per_minute','blocked_until','updated_at'],
  usage_ledger:['id','owner_id','reservation_id','event_type','credits','cost_microusd','metadata_json','created_at'],
  provider_price_snapshots:['id','provider','model','input_microusd_per_million','output_microusd_per_million','credit_value_microusd','effective_at','retired_at']
 };
 const rows=Object.entries(base).flatMap(([table,cols])=>cols.map(name=>({table_name:table,name})));
 rows.push({table_name:'usage_reservations',name:'request_hash'},{table_name:'provider_price_snapshots',name:'valid_until'});
 const allowed=reconciledMigrationColumns([{migration:'0001_atomic_chat_billing.sql',action:'reconcile'}]);
 assert.deepEqual(baselineColumnParity(rows,allowed),[]);
 assert.deepEqual(baselineColumnParity([...rows,{table_name:'usage_reservations',name:'unexpected_drift'}],allowed),[
  {table:'usage_reservations',missing:[],extra:['unexpected_drift']}
 ]);
});

test('unreconciled migration columns remain drift and malformed allowlists fail closed',()=>{
 const rows=[{table_name:'usage_reservations',name:'request_hash'}];
 assert.ok(baselineColumnParity(rows,[]).some(x=>x.table==='usage_reservations'&&x.extra.includes('request_hash')));
 assert.throws(()=>baselineColumnParity([],['bad']),/Allowed migration column metadata is malformed/);
});
