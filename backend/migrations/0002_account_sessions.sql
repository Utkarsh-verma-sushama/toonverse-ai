-- Apply after 0001 with account/AI execution disabled. No accounts are funded here.
CREATE TABLE account_profiles (
  owner_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','deletion_requested')),
  locale TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE account_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES account_profiles(owner_id),
  origin TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  device_name TEXT NOT NULL,
  credentials_cipher TEXT,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  authenticated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT,
  refresh_lock TEXT,
  refresh_started_at INTEGER
);
CREATE INDEX idx_account_sessions_owner ON account_sessions(owner_id,revoked_at,expires_at);
CREATE TABLE account_access_tokens (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES account_sessions(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE account_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES account_sessions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_account_access_expiry ON account_access_tokens(expires_at);
CREATE INDEX idx_account_refresh_session ON account_refresh_tokens(session_id);
CREATE TABLE account_security_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_account_security_owner ON account_security_events(owner_id,created_at DESC);
CREATE TRIGGER account_security_no_update BEFORE UPDATE ON account_security_events
BEGIN SELECT RAISE(ABORT,'SECURITY_EVENT_IMMUTABLE'); END;
CREATE TABLE account_rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK(count>=0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_account_rate_expiry ON account_rate_limits(expires_at);
CREATE TABLE account_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('mfa_signin','mfa_enroll','reauth_mfa')),
  owner_id TEXT,
  session_id TEXT,
  device_hash TEXT NOT NULL,
  origin TEXT NOT NULL,
  payload_cipher TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE account_deletion_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES account_profiles(owner_id),
  status TEXT NOT NULL CHECK(status IN ('pending_review','cancelled','completed')),
  requested_at INTEGER NOT NULL,
  eligible_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE UNIQUE INDEX idx_account_deletion_pending ON account_deletion_requests(owner_id) WHERE status='pending_review';
