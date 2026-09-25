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
