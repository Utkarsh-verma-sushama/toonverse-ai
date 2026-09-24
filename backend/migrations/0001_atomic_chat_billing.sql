-- Apply once after backend/schema.sql, with all metered execution disabled.
-- Existing reservations/ledger entries are preserved. Reconcile legacy holds
-- before activation; the new code refuses inconsistent balances.
ALTER TABLE provider_price_snapshots ADD COLUMN valid_until TEXT;
ALTER TABLE usage_reservations ADD COLUMN request_hash TEXT;
ALTER TABLE usage_reservations ADD COLUMN price_snapshot_id TEXT REFERENCES provider_price_snapshots(id);
ALTER TABLE usage_reservations ADD COLUMN input_token_limit INTEGER;
ALTER TABLE usage_reservations ADD COLUMN output_token_limit INTEGER;
ALTER TABLE usage_reservations ADD COLUMN input_tokens INTEGER;
ALTER TABLE usage_reservations ADD COLUMN output_tokens INTEGER;
ALTER TABLE usage_reservations ADD COLUMN global_cost_ceiling INTEGER;
ALTER TABLE usage_reservations ADD COLUMN provider_state TEXT NOT NULL DEFAULT 'not_started'
  CHECK(provider_state IN ('not_started','started','unknown','finished'));
ALTER TABLE usage_reservations ADD COLUMN provider_request_id TEXT;
ALTER TABLE usage_reservations ADD COLUMN failure_code TEXT;
ALTER TABLE usage_reservations ADD COLUMN expires_at TEXT;

CREATE TABLE chat_billing_policy (
  id TEXT PRIMARY KEY CHECK(id='chat'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  global_daily_cost_microusd INTEGER NOT NULL CHECK(typeof(global_daily_cost_microusd)='integer' AND global_daily_cost_microusd BETWEEN 1 AND 1000000000000),
  updated_at TEXT NOT NULL
);
-- No default budget or funded plan: deployment cannot silently authorize spend.
CREATE INDEX idx_usage_active ON usage_reservations(status,owner_id);
CREATE INDEX idx_usage_time ON usage_reservations(owner_id,julianday(created_at));
CREATE INDEX idx_usage_settled_time ON usage_reservations(status,julianday(settled_at));
CREATE INDEX idx_usage_owner_settled ON usage_reservations(owner_id,status,julianday(settled_at));
CREATE UNIQUE INDEX idx_chat_ledger_event ON usage_ledger(reservation_id,event_type)
  WHERE json_extract(metadata_json,'$.billingVersion')=2;

CREATE TRIGGER chat_reservation_guard BEFORE INSERT ON usage_reservations
BEGIN
  SELECT CASE WHEN NEW.feature!='chat_v2' THEN RAISE(ABORT,'BILLING_VERSION_REQUIRED') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM usage_reservations WHERE owner_id=NEW.owner_id AND idempotency_key=NEW.idempotency_key)
    THEN RAISE(ABORT,'IDEMPOTENCY_EXISTS') END;
  SELECT CASE WHEN NEW.status!='reserved' OR NEW.provider_state!='not_started'
    OR NEW.actual_credits IS NOT NULL OR NEW.actual_cost_microusd IS NOT NULL
    OR NEW.input_tokens IS NOT NULL OR NEW.output_tokens IS NOT NULL
    OR NEW.provider_request_id IS NOT NULL OR NEW.settled_at IS NOT NULL
    OR NEW.request_hash IS NULL OR length(NEW.request_hash)!=64
    OR NEW.input_token_limit IS NULL OR typeof(NEW.input_token_limit)!='integer' OR NEW.input_token_limit NOT BETWEEN 1 AND 12000
    OR NEW.output_token_limit IS NULL OR typeof(NEW.output_token_limit)!='integer' OR NEW.output_token_limit NOT BETWEEN 1 AND 8000
    OR NEW.global_cost_ceiling IS NULL OR typeof(NEW.global_cost_ceiling)!='integer' OR NEW.global_cost_ceiling NOT BETWEEN 1 AND 1000000000000
    OR abs(julianday(NEW.created_at)-julianday('now'))>0.0007 OR julianday(NEW.created_at) IS NULL
    OR julianday(NEW.expires_at) IS NULL OR julianday(NEW.expires_at)<=julianday('now')
    OR julianday(NEW.expires_at)>julianday('now','+10 minutes')
    THEN RAISE(ABORT,'INVALID_RESERVATION') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM chat_billing_policy WHERE id='chat' AND enabled=1)
    THEN RAISE(ABORT,'BILLING_DISABLED') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM provider_price_snapshots p WHERE p.id=NEW.price_snapshot_id
    AND p.retired_at IS NULL AND julianday(p.effective_at)<=julianday('now') AND julianday(p.valid_until)>julianday('now')
    AND typeof(p.input_microusd_per_million)='integer' AND p.input_microusd_per_million BETWEEN 0 AND 1000000000
    AND typeof(p.output_microusd_per_million)='integer' AND p.output_microusd_per_million BETWEEN 0 AND 1000000000
    AND typeof(p.credit_value_microusd)='integer' AND p.credit_value_microusd BETWEEN 1 AND 1000000000
    AND NEW.estimated_cost_microusd=(NEW.input_token_limit*p.input_microusd_per_million+NEW.output_token_limit*p.output_microusd_per_million+999999)/1000000
    AND NEW.estimated_credits=MAX(1,(NEW.estimated_cost_microusd+p.credit_value_microusd-1)/p.credit_value_microusd))
    THEN RAISE(ABORT,'PRICE_SNAPSHOT_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM billing_accounts a WHERE a.owner_id=NEW.owner_id AND a.status='active'
    AND julianday(a.cycle_started_at)<=julianday('now') AND julianday(a.cycle_ends_at)>julianday('now'))
    THEN RAISE(ABORT,'ACTIVE_SUBSCRIPTION_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM usage_limits WHERE owner_id=NEW.owner_id)
    THEN RAISE(ABORT,'USAGE_LIMITS_REQUIRED') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM usage_limits WHERE owner_id=NEW.owner_id AND blocked_until IS NOT NULL
    AND (julianday(blocked_until) IS NULL OR julianday(blocked_until)>julianday('now')))
    THEN RAISE(ABORT,'USAGE_TEMPORARILY_BLOCKED') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM billing_accounts a WHERE a.owner_id=NEW.owner_id
    AND a.reserved_credits!=(SELECT COALESCE(SUM(estimated_credits),0) FROM usage_reservations WHERE owner_id=NEW.owner_id AND status='reserved'))
    THEN RAISE(ABORT,'BILLING_RECONCILIATION_REQUIRED') END;
  SELECT CASE WHEN NEW.estimated_cost_microusd>(SELECT max_request_cost_microusd FROM usage_limits WHERE owner_id=NEW.owner_id)
    THEN RAISE(ABORT,'REQUEST_COST_LIMIT_EXCEEDED') END;
  SELECT CASE WHEN NEW.estimated_credits>(SELECT included_credits+prepaid_credits-reserved_credits FROM billing_accounts WHERE owner_id=NEW.owner_id)
    THEN RAISE(ABORT,'INSUFFICIENT_CREDITS') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM usage_reservations WHERE owner_id=NEW.owner_id AND julianday(created_at)>=julianday('now','-1 minute'))
    >=(SELECT requests_per_minute FROM usage_limits WHERE owner_id=NEW.owner_id)
    THEN RAISE(ABORT,'RATE_LIMIT_REACHED') END;
  -- Include all open holds, even if they started before this time window.
  SELECT CASE WHEN NEW.estimated_credits+(SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN estimated_credits ELSE actual_credits END),0)
    FROM usage_reservations WHERE owner_id=NEW.owner_id AND (status='reserved' OR (status='settled' AND julianday(settled_at)>=julianday('now','-1 day'))))
    >(SELECT daily_credit_limit FROM usage_limits WHERE owner_id=NEW.owner_id)
    THEN RAISE(ABORT,'DAILY_QUOTA_REACHED') END;
  SELECT CASE WHEN NEW.estimated_credits+(SELECT COALESCE(SUM(CASE WHEN r.status='reserved' THEN r.estimated_credits ELSE r.actual_credits END),0)
    FROM usage_reservations r JOIN billing_accounts a ON a.owner_id=r.owner_id WHERE r.owner_id=NEW.owner_id
    AND (r.status='reserved' OR (r.status='settled' AND julianday(r.settled_at)>=julianday(a.cycle_started_at))))
    >(SELECT monthly_credit_limit FROM usage_limits WHERE owner_id=NEW.owner_id)
    THEN RAISE(ABORT,'MONTHLY_QUOTA_REACHED') END;
  SELECT CASE WHEN NEW.estimated_cost_microusd+(SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN estimated_cost_microusd ELSE actual_cost_microusd END),0)
    FROM usage_reservations WHERE status='reserved' OR (status='settled' AND julianday(settled_at)>=julianday('now','-1 day')))
    >MIN(NEW.global_cost_ceiling,(SELECT global_daily_cost_microusd FROM chat_billing_policy WHERE id='chat'))
    THEN RAISE(ABORT,'GLOBAL_SPEND_CEILING_REACHED') END;
END;

CREATE TRIGGER chat_reservation_hold AFTER INSERT ON usage_reservations
WHEN NEW.feature='chat_v2'
BEGIN
  -- These are provisional hold buckets; final debit consumes included credits first.
  INSERT INTO usage_ledger(id,owner_id,reservation_id,event_type,credits,cost_microusd,metadata_json,created_at)
    SELECT NEW.id||':reserve_included',NEW.owner_id,NEW.id,'reserve_included',MIN(NEW.estimated_credits,MAX(0,included_credits-reserved_credits)),0,
      json_object('billingVersion',2,'priceSnapshotId',NEW.price_snapshot_id),NEW.created_at
    FROM billing_accounts WHERE owner_id=NEW.owner_id AND MIN(NEW.estimated_credits,MAX(0,included_credits-reserved_credits))>0;
  INSERT INTO usage_ledger(id,owner_id,reservation_id,event_type,credits,cost_microusd,metadata_json,created_at)
    SELECT NEW.id||':reserve_prepaid',NEW.owner_id,NEW.id,'reserve_prepaid',NEW.estimated_credits-MIN(NEW.estimated_credits,MAX(0,included_credits-reserved_credits)),0,
      json_object('billingVersion',2,'priceSnapshotId',NEW.price_snapshot_id),NEW.created_at
    FROM billing_accounts WHERE owner_id=NEW.owner_id AND NEW.estimated_credits>MAX(0,included_credits-reserved_credits);
  UPDATE billing_accounts SET reserved_credits=reserved_credits+NEW.estimated_credits,updated_at=NEW.created_at WHERE owner_id=NEW.owner_id;
END;

CREATE TRIGGER chat_reservation_transition BEFORE UPDATE ON usage_reservations
WHEN OLD.feature='chat_v2'
BEGIN
  SELECT CASE WHEN OLD.status!='reserved' THEN RAISE(ABORT,'RESERVATION_FINALIZED') END;
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.feature IS NOT OLD.feature
    OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.request_hash IS NOT OLD.request_hash
    OR NEW.price_snapshot_id IS NOT OLD.price_snapshot_id OR NEW.estimated_credits IS NOT OLD.estimated_credits
    OR NEW.estimated_cost_microusd IS NOT OLD.estimated_cost_microusd OR NEW.input_token_limit IS NOT OLD.input_token_limit
    OR NEW.output_token_limit IS NOT OLD.output_token_limit OR NEW.global_cost_ceiling IS NOT OLD.global_cost_ceiling
    OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
    THEN RAISE(ABORT,'RESERVATION_IMMUTABLE') END;
  SELECT CASE WHEN NOT (
    (OLD.provider_state='not_started' AND NEW.provider_state IN ('not_started','started','finished'))
    OR (OLD.provider_state IN ('started','unknown') AND NEW.provider_state IN ('unknown','finished')))
    THEN RAISE(ABORT,'INVALID_PROVIDER_TRANSITION') END;
  SELECT CASE WHEN NEW.provider_state='started' AND (
    julianday(OLD.expires_at)<=julianday('now')
    OR NOT EXISTS(SELECT 1 FROM chat_billing_policy WHERE id='chat' AND enabled=1)
    OR NOT EXISTS(SELECT 1 FROM billing_accounts WHERE owner_id=OLD.owner_id AND status='active' AND julianday(cycle_ends_at)>julianday('now')))
    THEN RAISE(ABORT,'DISPATCH_NOT_ALLOWED') END;
  SELECT CASE WHEN NEW.status NOT IN ('reserved','settled','released') THEN RAISE(ABORT,'INVALID_BILLING_TRANSITION') END;
  SELECT CASE WHEN NEW.status='reserved' AND (NEW.actual_credits IS NOT NULL OR NEW.actual_cost_microusd IS NOT NULL
    OR NEW.input_tokens IS NOT NULL OR NEW.output_tokens IS NOT NULL OR NEW.settled_at IS NOT NULL OR NEW.provider_state='finished')
    THEN RAISE(ABORT,'INVALID_BILLING_TRANSITION') END;
  SELECT CASE WHEN NEW.status IN ('settled','released') AND (NEW.provider_state!='finished' OR julianday(NEW.settled_at) IS NULL
    OR abs(julianday(NEW.settled_at)-julianday('now'))>0.0007)
    THEN RAISE(ABORT,'INVALID_BILLING_TRANSITION') END;
  SELECT CASE WHEN NEW.status='released' AND (NEW.actual_credits IS NOT 0 OR NEW.actual_cost_microusd IS NOT 0
    OR NEW.input_tokens IS NOT 0 OR NEW.output_tokens IS NOT 0
    OR (OLD.provider_state!='not_started' AND (NEW.failure_code IS NOT 'CONFIRMED_NOT_BILLED'
      OR NEW.provider_request_id IS NULL OR length(NEW.provider_request_id) NOT BETWEEN 1 AND 200)))
    THEN RAISE(ABORT,'RECONCILIATION_REQUIRED') END;
  SELECT CASE WHEN NEW.status='settled' AND (OLD.provider_state NOT IN ('started','unknown')
    OR NEW.provider_request_id IS NULL OR length(NEW.provider_request_id) NOT BETWEEN 1 AND 200
    OR typeof(NEW.input_tokens)!='integer' OR NEW.input_tokens NOT BETWEEN 0 AND OLD.input_token_limit
    OR typeof(NEW.output_tokens)!='integer' OR NEW.output_tokens NOT BETWEEN 0 AND OLD.output_token_limit
    OR NEW.actual_credits IS NULL OR NEW.actual_credits>OLD.estimated_credits
    OR NEW.actual_cost_microusd IS NULL OR NEW.actual_cost_microusd>OLD.estimated_cost_microusd
    OR NOT EXISTS(SELECT 1 FROM provider_price_snapshots p WHERE p.id=OLD.price_snapshot_id
      AND NEW.actual_cost_microusd=(NEW.input_tokens*p.input_microusd_per_million+NEW.output_tokens*p.output_microusd_per_million+999999)/1000000
      AND NEW.actual_credits=(NEW.actual_cost_microusd+p.credit_value_microusd-1)/p.credit_value_microusd))
    THEN RAISE(ABORT,'INVALID_PROVIDER_USAGE') END;
END;

CREATE TRIGGER chat_reservation_finish AFTER UPDATE OF status ON usage_reservations
WHEN OLD.feature='chat_v2' AND OLD.status='reserved' AND NEW.status IN ('settled','released')
BEGIN
  INSERT INTO usage_ledger(id,owner_id,reservation_id,event_type,credits,cost_microusd,metadata_json,created_at)
    SELECT NEW.id||':'||CASE WHEN NEW.status='settled' THEN 'settle' ELSE 'release' END,NEW.owner_id,NEW.id,
      CASE WHEN NEW.status='settled' THEN 'settle' ELSE 'release' END,
      CASE WHEN NEW.status='settled' THEN NEW.actual_credits ELSE OLD.estimated_credits END,NEW.actual_cost_microusd,
      json_object('billingVersion',2,'priceSnapshotId',NEW.price_snapshot_id,'inputTokens',NEW.input_tokens,'outputTokens',NEW.output_tokens,
        'includedCharged',MIN(included_credits,NEW.actual_credits),'prepaidCharged',MAX(0,NEW.actual_credits-included_credits),
        'unusedCredits',OLD.estimated_credits-NEW.actual_credits,'reason',NEW.failure_code),NEW.settled_at
    FROM billing_accounts WHERE owner_id=NEW.owner_id;
  UPDATE billing_accounts SET
    included_credits=MAX(0,included_credits-NEW.actual_credits),
    prepaid_credits=prepaid_credits-MAX(0,NEW.actual_credits-included_credits),
    reserved_credits=reserved_credits-OLD.estimated_credits,updated_at=NEW.settled_at
    WHERE owner_id=NEW.owner_id;
END;

CREATE TRIGGER chat_reservation_no_delete BEFORE DELETE ON usage_reservations
WHEN OLD.feature='chat_v2' BEGIN SELECT RAISE(ABORT,'RESERVATION_IMMUTABLE'); END;
CREATE TRIGGER usage_ledger_no_update BEFORE UPDATE ON usage_ledger
BEGIN SELECT RAISE(ABORT,'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER usage_ledger_no_delete BEFORE DELETE ON usage_ledger
BEGIN SELECT RAISE(ABORT,'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER price_snapshot_no_change BEFORE UPDATE ON provider_price_snapshots
WHEN NEW.id IS NOT OLD.id OR NEW.provider IS NOT OLD.provider OR NEW.model IS NOT OLD.model
  OR NEW.input_microusd_per_million IS NOT OLD.input_microusd_per_million
  OR NEW.output_microusd_per_million IS NOT OLD.output_microusd_per_million
  OR NEW.credit_value_microusd IS NOT OLD.credit_value_microusd OR NEW.effective_at IS NOT OLD.effective_at
  OR NEW.valid_until IS NOT OLD.valid_until OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS NOT OLD.retired_at)
BEGIN SELECT RAISE(ABORT,'PRICE_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER price_snapshot_no_delete BEFORE DELETE ON provider_price_snapshots
BEGIN SELECT RAISE(ABORT,'PRICE_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER billing_account_guard BEFORE UPDATE ON billing_accounts
BEGIN
  SELECT CASE WHEN typeof(NEW.included_credits)!='integer' OR typeof(NEW.prepaid_credits)!='integer' OR typeof(NEW.reserved_credits)!='integer'
    OR NEW.included_credits NOT BETWEEN 0 AND 1000000000000 OR NEW.prepaid_credits NOT BETWEEN 0 AND 1000000000000
    OR NEW.reserved_credits<0 OR NEW.reserved_credits>NEW.included_credits+NEW.prepaid_credits
    THEN RAISE(ABORT,'BILLING_BALANCE_INVALID') END;
  SELECT CASE WHEN OLD.reserved_credits>0 AND (NEW.owner_id IS NOT OLD.owner_id
    OR NEW.cycle_started_at IS NOT OLD.cycle_started_at OR NEW.cycle_ends_at IS NOT OLD.cycle_ends_at)
    THEN RAISE(ABORT,'PENDING_RESERVATIONS') END;
END;
