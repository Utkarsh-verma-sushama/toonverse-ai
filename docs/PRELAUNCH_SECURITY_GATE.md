# Uvenaro Pre-launch Security Gate

Security is a release requirement, not a post-launch task.

## Mandatory fail-closed controls
- AI/provider secrets remain server-side; no secret is shipped in web/mobile bundles.
- Paid AI endpoints require authenticated, active, verified accounts.
- Production requests require application/device attestation where the platform supports it.
- Idempotency and a durable server-side cost reservation occur before provider dispatch.
- Per-request token/cost limits, per-account daily/monthly limits, rate limits, concurrency limits and a global spend ceiling are server-authoritative.
- Provider calls are disabled by default and can be stopped independently through emergency kill switches.
- Unknown provider outcomes remain reserved for reconciliation and are never silently released.
- Client-supplied plan, credit, role, owner or cost values are never authoritative.
- Firestore/Storage remain private-by-default with explicit owner authorization.
- SQL uses bound parameters; dynamic user-controlled SQL is prohibited.
- High-cost endpoints must reject oversized, malformed, replayed, unauthenticated, unverified or non-attested requests before provider dispatch.

## Abuse and denial-of-wallet defense
Production must enforce independent limits for identity, account, device/app attestation, network velocity, request rate, concurrent expensive jobs, per-request cost, rolling spend velocity, daily/monthly account spend and global provider spend. A limit failure must fail closed before an upstream paid request begins.

## AI/agent controls
Tools are allowlisted and least-privilege. Expensive capabilities are separately gated. Agent actions with external or irreversible effects require explicit authorization and bounded budgets. Provider responses are treated as untrusted input and validated against the billing contract.

## Supply chain and operations
Lockfiles, dependency updates, least-privilege CI permissions, security scanning, secret scanning, protected release checks, audit logs, spend/security alerts, backup/restore tests, credential/session revocation and incident runbooks are required.

## Release blockers
Do not ship test/soft/public production access while any Critical/High security issue is unresolved, paid execution lacks a tested hard ceiling, production attestation is unenforced, secrets are exposed, authorization negative tests fail, or emergency shutdown/reconciliation tests fail.

This gate targets maximum practical resilience and bounded financial impact; it is not a mathematical guarantee that exploitation can never occur.
