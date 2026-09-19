# UVENARO Chat Core contract

Chat Core defaults to safe-off until a production model provider, verified identity and server-authoritative billing guard are connected.

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
