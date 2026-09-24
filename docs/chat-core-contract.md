# UVENARO Chat Core contract

Chat Core defaults to safe-off until a production model provider, verified identity and server-authoritative billing guard are connected.

## Identity boundary

Protected application requests carry a short-lived opaque `uv1.` access token in `Authorization: Bearer`. The Worker checks its managed account session, then cryptographically verifies the encrypted server-held Firebase ID token (RS256, issuer, audience, subject and timestamps) and current Firebase account status/revocation. Raw Firebase JWTs and client identity headers cannot bypass managed-session revocation. `ACCOUNT_SESSION_KEY`, D1, matching Firebase configuration and explicit account activation are required. `AUTH_REQUIRED=false` does not bypass verification. See [Account Backend](account-backend-checkpoint.md).

## Request gate order

1. Verify identity, account status and plan entitlement.
2. Enforce per-minute, daily, monthly, device-risk and abuse limits.
3. Estimate worst-case provider cost before the request leaves UVENARO.
4. Atomically reserve included credits first, then prepaid credits.
5. Reject when credits or the plan cost ceiling are insufficient. Never create a negative balance or postpaid surprise bill.
6. Execute only through an allowlisted route with time, token, tool and cost ceilings.
7. Settle actual usage; release unused credits and apply the documented failed-job policy.
8. Record an append-only ledger event without routine prompt or private-file logging.

Fair-use and safety controls apply throughout, including prepaid usage. Subscription access never means unbounded provider spend. Local/offline features do not consume AI credits.

## Required production hardening

- Idempotency, replay protection and atomic reservation/settlement
- Provider price snapshots, global spend ceilings and emergency kill switch
- Rate limiting, bot detection and step-up verification
- Prompt-injection, tool-permission and data-exfiltration defenses
- Encryption, short retention, export and deletion controls
- Streaming cancellation and upstream cancellation where supported
- Usage dashboard, low-balance alerts and transparent credit receipts
- Reconciliation, refund, fraud, tax and payment-failure handling
- Load, outage, concurrency, double-spend, security and billing tests

Prices and included credits remain unset until verified provider costs, taxes, payment fees, refund reserve, infrastructure cost and target margin are approved.

## Activation invariants

- Production must keep `CHAT_EXECUTION_ENABLED=false` until verified edge authentication, D1 migrations, a current provider-price snapshot, funded plans, global budget alerts and an encrypted provider secret are all present.
- The public client never receives provider credentials and never calls a paid provider directly.
- Every accepted request requires a unique idempotency key and a server-side verified subject.
- Confirmed zero-cost rejection releases the reservation. Timeout, unknown provider outcome or unconfirmed settlement retains the hold for reconciliation. Successful execution settles measured usage and emits a ledger receipt.
- Pricing changes create a new immutable snapshot. Historical usage is never recalculated against a later price.

## Atomic billing checkpoint — 24 September 2026

The reservation/quota/settlement implementation and retry-safe client are described in [Atomic Chat Billing](atomic-chat-billing.md). The metered gateway contract, price snapshots, funded accounts and production activation remain separate gates.
