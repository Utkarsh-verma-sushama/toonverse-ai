# Explicit activation authorization

Activation authorization is now a separate fail-closed contract. A record must have an owner/operator, exact `provider-generation` scope, a short freshness window, a reason, an authorization ID, and a verified SHA-256 digest.

The record must also prove owner spend remains zero, billing configuration is not being changed, and background AI remains disabled. Missing, stale, future-dated, tampered, or broad-scope approvals are rejected.

This contract does not activate generation by itself. The runtime remains SAFE_OFF_PENDING until every provider acceptance gate and live-operations review passes, followed by a valid explicit authorization record.
