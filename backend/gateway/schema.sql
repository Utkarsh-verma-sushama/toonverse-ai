-- Dedicated gateway receipt database. Apply only with generation disabled.
CREATE TABLE gateway_control (
 id TEXT PRIMARY KEY CHECK(id='gateway'),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);
INSERT INTO gateway_control (id,enabled) VALUES ('gateway',0);
CREATE TABLE gateway_receipts (
 request_id TEXT PRIMARY KEY,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 input_limit INTEGER NOT NULL CHECK(typeof(input_limit)='integer' AND input_limit BETWEEN 1 AND 12000),
 output_limit INTEGER NOT NULL CHECK(typeof(output_limit)='integer' AND output_limit BETWEEN 1 AND 8000),
 status TEXT NOT NULL CHECK(status IN ('dispatching','unknown','completed','rejected')),
 record_id TEXT,
 billable INTEGER CHECK(billable IN (0,1)),
 input_tokens INTEGER,
 output_tokens INTEGER,
 created_at TEXT NOT NULL,
 finalized_at TEXT,
 CHECK(
  (status IN ('dispatching','unknown') AND record_id IS NULL AND billable IS NULL AND input_tokens IS NULL AND output_tokens IS NULL AND finalized_at IS NULL)
  OR (status='completed' AND record_id IS NOT NULL AND billable IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL
   AND length(record_id) BETWEEN 1 AND 200 AND billable=1
   AND typeof(input_tokens)='integer' AND input_tokens BETWEEN 0 AND input_limit
   AND typeof(output_tokens)='integer' AND output_tokens BETWEEN 0 AND output_limit AND finalized_at IS NOT NULL)
  OR (status='rejected' AND record_id IS NOT NULL AND billable IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL
   AND length(record_id) BETWEEN 1 AND 200 AND billable=0
   AND input_tokens=0 AND output_tokens=0 AND finalized_at IS NOT NULL)
 )
);
CREATE UNIQUE INDEX gateway_provider_record ON gateway_receipts(provider,record_id) WHERE record_id IS NOT NULL;
CREATE TRIGGER gateway_receipt_insert BEFORE INSERT ON gateway_receipts
WHEN NEW.status!='dispatching' OR NEW.record_id IS NOT NULL OR NEW.billable IS NOT NULL
 OR NEW.input_tokens IS NOT NULL OR NEW.output_tokens IS NOT NULL OR NEW.finalized_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'GATEWAY_INVALID_CLAIM'); END;
CREATE TRIGGER gateway_receipt_update BEFORE UPDATE ON gateway_receipts
WHEN OLD.status IN ('completed','rejected')
 OR NEW.request_id IS NOT OLD.request_id OR NEW.request_hash IS NOT OLD.request_hash
 OR NEW.provider IS NOT OLD.provider OR NEW.model IS NOT OLD.model
 OR NEW.input_limit IS NOT OLD.input_limit OR NEW.output_limit IS NOT OLD.output_limit
 OR NEW.created_at IS NOT OLD.created_at OR NEW.status='dispatching'
BEGIN SELECT RAISE(ABORT,'GATEWAY_IMMUTABLE_RECEIPT'); END;
CREATE TRIGGER gateway_receipt_delete BEFORE DELETE ON gateway_receipts
BEGIN SELECT RAISE(ABORT,'GATEWAY_RECEIPT_RETENTION_REQUIRED'); END;
