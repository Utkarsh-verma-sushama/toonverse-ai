-- Defense-in-depth limits for paid AI execution.
-- Apply after 0001_atomic_chat_billing.sql while metered execution is disabled.
ALTER TABLE usage_limits ADD COLUMN max_concurrent_requests INTEGER NOT NULL DEFAULT 2
  CHECK(max_concurrent_requests BETWEEN 1 AND 16);
ALTER TABLE usage_limits ADD COLUMN hourly_cost_limit_microusd INTEGER NOT NULL DEFAULT 100000
  CHECK(hourly_cost_limit_microusd BETWEEN 1 AND 1000000000000);

DROP TRIGGER chat_reservation_guard;
CREATE TRIGGER chat_reservation_guard BEFORE INSERT ON usage_reservations
BEGIN
  SELECT CASE WHEN NEW.feature!='chat_v2' THEN RAISE(ABORT,'BILLING_VERSION_REQUIRED') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM usage_reservations WHERE owner_id=NEW.owner_id AND idempotency_key=NEW.idempotency_key)
    THEN RAISE(ABORT,'IDEMPOTENCY_EXISTS') END;
  SELECT CASE WHEN NEW.status!='reserved' OR NEW.provider_state!='not_started'
    OR NEW.actual_credits IS NOT NULL OR NEW.actual_cost_microusd IS NOT NULL
    OR NEW.input_tokens IS NOT NULL OR NEW.output_tokens IS NOT NULL OR NEW.provider_request_id IS NOT NULL
    OR NEW.settled_at IS NOT NULL OR NEW.request_hash IS NULL OR length(NEW.request_hash)!=64
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
  SELECT CASE WHEN (SELECT COUNT(*) FROM usage_reservations WHERE owner_id=NEW.owner_id AND status='reserved')
    >=(SELECT max_concurrent_requests FROM usage_limits WHERE owner_id=NEW.owner_id)
    THEN RAISE(ABORT,'CONCURRENCY_LIMIT_REACHED') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM usage_reservations WHERE owner_id=NEW.owner_id AND julianday(created_at)>=julianday('now','-1 minute'))
    >=(SELECT requests_per_minute FROM usage_limits WHERE owner_id=NEW.owner_id)
    THEN RAISE(ABORT,'RATE_LIMIT_REACHED') END;
  SELECT CASE WHEN NEW.estimated_cost_microusd+(SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN estimated_cost_microusd ELSE actual_cost_microusd END),0)
    FROM usage_reservations WHERE owner_id=NEW.owner_id AND (status='reserved' OR (status='settled' AND julianday(settled_at)>=julianday('now','-1 hour'))))
    >(SELECT hourly_cost_limit_microusd FROM usage_limits WHERE owner_id=NEW.owner_id)
    THEN RAISE(ABORT,'HOURLY_SPEND_LIMIT_REACHED') END;
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
