-- Apply backend/gateway/schema.sql first to a NEW isolated adapter database,
-- then this extension. Gateway, adapter and account-pilot DBs are distinct.
CREATE TABLE adapter_vendor_evidence (
 request_id TEXT PRIMARY KEY REFERENCES gateway_receipts(request_id),
 vendor_response_id TEXT NOT NULL UNIQUE CHECK(length(vendor_response_id) BETWEEN 1 AND 200),
 record_id TEXT NOT NULL UNIQUE CHECK(length(record_id)=71),
 input_tokens INTEGER NOT NULL CHECK(typeof(input_tokens)='integer' AND input_tokens>=0),
 output_tokens INTEGER NOT NULL CHECK(typeof(output_tokens)='integer' AND output_tokens>=0),
 created_at TEXT NOT NULL
);
CREATE TRIGGER adapter_evidence_guard BEFORE INSERT ON adapter_vendor_evidence
WHEN NOT EXISTS (SELECT 1 FROM gateway_receipts r WHERE r.request_id=NEW.request_id
 AND r.status IN ('dispatching','unknown') AND NEW.input_tokens<=r.input_limit AND NEW.output_tokens<=r.output_limit)
BEGIN SELECT RAISE(ABORT,'ADAPTER_INVALID_EVIDENCE'); END;
CREATE TRIGGER adapter_evidence_no_update BEFORE UPDATE ON adapter_vendor_evidence
BEGIN SELECT RAISE(ABORT,'ADAPTER_IMMUTABLE_EVIDENCE'); END;
CREATE TRIGGER adapter_evidence_no_delete BEFORE DELETE ON adapter_vendor_evidence
BEGIN SELECT RAISE(ABORT,'ADAPTER_RETENTION_REQUIRED'); END;
