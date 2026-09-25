ALTER TABLE agent_approvals ADD COLUMN step_id TEXT REFERENCES agent_steps(id);
ALTER TABLE agent_approvals ADD COLUMN input_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_approvals_step_binding
ON agent_approvals(run_id,step_id)
WHERE step_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_agent_approval_binding_insert
BEFORE INSERT ON agent_approvals
WHEN NEW.decision='approve' AND (NEW.step_id IS NOT NULL OR NEW.input_hash IS NOT NULL)
BEGIN
 SELECT CASE WHEN NEW.step_id IS NULL OR NEW.input_hash IS NULL OR length(NEW.input_hash)<>64
  OR NOT EXISTS (
   SELECT 1 FROM agent_steps s
   WHERE s.id=NEW.step_id AND s.run_id=NEW.run_id
    AND s.tool_name=NEW.action_type AND s.input_hash=NEW.input_hash
  )
 THEN RAISE(ABORT,'AGENT_APPROVAL_STEP_BINDING_REQUIRED') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_approval_binding_update
BEFORE UPDATE OF decision,action_type,step_id,input_hash ON agent_approvals
WHEN NEW.decision='approve' AND (NEW.step_id IS NOT NULL OR NEW.input_hash IS NOT NULL)
BEGIN
 SELECT CASE WHEN NEW.step_id IS NULL OR NEW.input_hash IS NULL OR length(NEW.input_hash)<>64
  OR NOT EXISTS (
   SELECT 1 FROM agent_steps s
   WHERE s.id=NEW.step_id AND s.run_id=NEW.run_id
    AND s.tool_name=NEW.action_type AND s.input_hash=NEW.input_hash
  )
 THEN RAISE(ABORT,'AGENT_APPROVAL_STEP_BINDING_REQUIRED') END;
END;