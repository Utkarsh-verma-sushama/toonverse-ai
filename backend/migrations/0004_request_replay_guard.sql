-- One-time replay nonces for high-cost authenticated operations.
-- Server inserts/consumes these atomically before provider dispatch.
CREATE TABLE request_nonces (
  owner_id TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('chat','agent','media')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,nonce_hash,purpose)
);
CREATE INDEX idx_request_nonces_expiry ON request_nonces(julianday(expires_at));

CREATE TRIGGER request_nonce_guard BEFORE INSERT ON request_nonces
BEGIN
  SELECT CASE WHEN NEW.owner_id IS NULL OR length(NEW.owner_id) NOT BETWEEN 1 AND 128
    OR NEW.nonce_hash IS NULL OR length(NEW.nonce_hash)!=64
    OR NEW.nonce_hash GLOB '*[^0-9a-f]*'
    OR julianday(NEW.created_at) IS NULL OR abs(julianday(NEW.created_at)-julianday('now'))>0.0007
    OR julianday(NEW.expires_at) IS NULL OR julianday(NEW.expires_at)<=julianday('now')
    OR julianday(NEW.expires_at)>julianday('now','+10 minutes')
    THEN RAISE(ABORT,'INVALID_REQUEST_NONCE') END;
END;

CREATE TRIGGER request_nonce_immutable BEFORE UPDATE ON request_nonces
BEGIN SELECT RAISE(ABORT,'REQUEST_NONCE_IMMUTABLE'); END;
