-- Append-only, server-owned audit trail for security-sensitive agent lifecycle changes.
CREATE TABLE IF NOT EXISTS agent_audit_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('created','claimed','expired','quarantined','runtime_failed','cancelled','approval_decided','queue_dispatch_failed')),
  from_state TEXT,
  to_state TEXT,
  approval_id TEXT,
  decision TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_run_created ON agent_audit_events(run_id,created_at);
CREATE INDEX IF NOT EXISTS idx_agent_audit_owner_created ON agent_audit_events(owner_id,created_at DESC);

CREATE TRIGGER IF NOT EXISTS agent_audit_events_no_update
BEFORE UPDATE ON agent_audit_events
BEGIN
  SELECT RAISE(ABORT,'AGENT_AUDIT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS agent_audit_events_no_delete
BEFORE DELETE ON agent_audit_events
BEGIN
  SELECT RAISE(ABORT,'AGENT_AUDIT_IMMUTABLE');
END;

-- Audit successful lifecycle changes inside the same SQLite statement transaction.
CREATE TRIGGER IF NOT EXISTS agent_runs_audit_status
AFTER UPDATE OF status ON agent_runs
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO agent_audit_events(id,run_id,owner_id,event_type,from_state,to_state,error_code,created_at)
  VALUES(
    lower(hex(randomblob(16))), NEW.id, NEW.owner_id,
    CASE
      WHEN NEW.status='planning' THEN 'claimed'
      WHEN NEW.status='expired' THEN 'expired'
      WHEN NEW.status='cancelled' THEN 'cancelled'
      WHEN NEW.status='failed' AND NEW.error_code='AGENT_PERSISTED_INPUT_INVALID' THEN 'quarantined'
      WHEN NEW.status='failed' AND NEW.error_code='QUEUE_DISPATCH_FAILED' THEN 'queue_dispatch_failed'
      ELSE 'runtime_failed'
    END,
    OLD.status, NEW.status, NEW.error_code, strftime('%Y-%m-%dT%H:%M:%fZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS agent_approvals_audit_decision
AFTER UPDATE OF decision ON agent_approvals
WHEN OLD.decision <> NEW.decision
BEGIN
  INSERT INTO agent_audit_events(id,run_id,owner_id,event_type,from_state,to_state,approval_id,decision,created_at)
  VALUES(lower(hex(randomblob(16))),NEW.run_id,NEW.owner_id,'approval_decided',OLD.decision,NEW.decision,NEW.id,NEW.decision,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
