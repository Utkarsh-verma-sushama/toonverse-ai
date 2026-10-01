-- Fail closed if concurrent requests try to exceed the per-owner active-agent cap.
-- The API pre-check gives a friendly 429; this trigger is the authoritative race-safe guard.
CREATE TRIGGER IF NOT EXISTS agent_runs_active_cap_insert
BEFORE INSERT ON agent_runs
WHEN NEW.status IN ('queued','planning','running','awaiting_approval')
 AND (SELECT COUNT(*) FROM agent_runs
      WHERE owner_id=NEW.owner_id
        AND status IN ('queued','planning','running','awaiting_approval')) >= 2
BEGIN
  SELECT RAISE(ABORT,'AGENT_CONCURRENCY_LIMIT_REACHED');
END;

CREATE TRIGGER IF NOT EXISTS agent_runs_active_cap_update
BEFORE UPDATE OF status,owner_id ON agent_runs
WHEN NEW.status IN ('queued','planning','running','awaiting_approval')
 AND OLD.status NOT IN ('queued','planning','running','awaiting_approval')
 AND (SELECT COUNT(*) FROM agent_runs
      WHERE owner_id=NEW.owner_id
        AND status IN ('queued','planning','running','awaiting_approval')
        AND id<>OLD.id) >= 2
BEGIN
  SELECT RAISE(ABORT,'AGENT_CONCURRENCY_LIMIT_REACHED');
END;
