# Atomic Chat Billing — 24 September 2026

## Implementation status

The billing source, database migration and tests are implemented. Paid AI remains disabled. There is no live provider call, funded-plan setup, payment integration or production deployment in this checkpoint.

Previous security work is in PR #9, commit `a1517f7bcc0c56302bf670a52d07955f13980118`; both Cloud and Native CI passed. This change builds on that code.

## What is now atomic

`backend/chat-billing.mjs` uses a single reservation INSERT or state-transition UPDATE. SQLite/D1 triggers in `backend/migrations/0001_atomic_chat_billing.sql` enforce all related balance and ledger changes within that same transaction. A failed ledger or account write rolls back the reservation transition.

Reservation checks include:

- Active account and valid billing-cycle boundaries.
- Explicit, current, immutable provider price snapshot, including expiry.
- Available included plus prepaid credits minus open reservations.
- Per-request cost limit; per-minute request count; trailing-24-hour credit allowance; billing-cycle credit allowance.
- Global trailing-24-hour provider budget, constrained by both database policy and the Worker ceiling. A zero/missing Worker ceiling cannot mean unlimited spend.
- **Every open hold**, including old unresolved requests, counts against daily, monthly and global budgets.
- Unique `(owner_id, idempotency_key)` and a fingerprint of owner, provider/model, full normalized conversation and token ceilings.
- Balance counter reconciliation. Legacy mismatches block execution rather than silently resetting held credits.

Costs use integer micro-USD and `BigInt` arithmetic, rounded up once at the cost boundary and once at the credit boundary. No currency conversion, credit price or subscription amount is invented here. Tests use synthetic prices only.

## Request lifecycle

| Result | Reservation | Credit balance | Provider budget |
|---|---|---|---|
| Rejected before reservation | No new row | Unchanged | Unchanged |
| Accepted, not dispatched | Reserved | Held, not charged | Full input/output ceiling reserved |
| Provider call started | Reserved / started | Held | Full ceiling remains counted |
| Completed with valid measured usage | Settled | Actual usage debited; unused hold freed | Actual quoted usage counted |
| Explicit provider rejection, confirmed zero usage and no charge | Released | Entire hold freed | Zero cost |
| Timeout, lost connection, crash after dispatch, invalid usage or unconfirmed settlement | Reserved / started or unknown | Held pending reconciliation | Full ceiling remains counted |
| Never dispatched and expired | Released by a bounded sweep | Entire hold freed | Zero cost |

Settlement is idempotent. Repeating the same measured usage and provider request ID returns the same receipt, without another debit. Conflicting settlements fail. Included credits are consumed before prepaid credits using the balances in the same atomic transaction. Billing cycles cannot roll over while holds remain.

Closed reservations, quote terms and ledger events are immutable to ordinary update/delete operations. Retiring a quote only prevents new reservations; an existing reservation settles against its original quote.

## Retry and receipt behavior

`GET /v1/chat/requests/{requestKey}` returns only the authenticated owner's status and credit receipt. It does not invoke a provider or reveal prompt/output content.

The chat client persists a pending request's original key and body before execution. A page reload, double tap or retry reuses that key. It prevents a different request or clearing the pending history until the outcome is checked. Local chat/pending keys are scoped to the signed-in account. Storage persistence failure stops execution before a provider call.

The page has **Check last request** and **Retry last request** controls. If the original reply was lost after successful settlement, its credit receipt can be recovered. The answer itself is not stored on the server in this checkpoint and cannot be replayed. The UI explicitly reports that limitation instead of starting another paid request.

## Metered provider contract — required before activation

`backend/chat-execution.mjs` requires an audited HTTPS gateway using protocol `metered-v1`, an exact configured allowed origin, an encrypted server API secret, disabled redirects, no tools and no routine prompt retention. **This contract is not a completed Gemini/OpenAI/other-provider adapter. Do not point it directly at a raw model API.**

The request contains `request_id`, `model`, `messages`, `max_input_tokens`, `max_output_tokens`, `tools: []`, and `store: false`. The same durable request ID is the upstream idempotency key. The gateway must enforce the total input limit before any billable call, enforce total output/reasoning-token limits, deduplicate calls, and report usage including all billable system/context/reasoning tokens. The reservation covers the entire configured input/output ceiling, so a small prompt may initially hold more credits than it finally uses.

A completed response must contain:

```json
{
  "id": "provider-record-id",
  "request_id": "the-original-reservation-id",
  "model": "the-exact-quoted-model",
  "status": "completed",
  "output": "answer text",
  "usage": {"input_tokens": 100, "output_tokens": 50}
}
```

A no-charge rejection must carry the same correlation/model fields, `status: "rejected"`, `billable: false`, and both usage counts equal to zero. Generic HTTP failures do not establish that no cost occurred. Invalid measured usage or a parsed response that violates the cost contract disables new billing through the database kill switch and retains the hold for investigation.

No client-supplied price, model override, credit count or system-role instruction changes the server's spending limits. Provider tools and extra charge categories are outside this text-only contract.

## Migration and activation sequence

1. Keep all metered execution flags off and stop old writers. Take a database backup and rehearse restore in staging.
2. For a fresh database, apply `backend/schema.sql` first. For an existing database, preserve that baseline schema and data.
3. Apply `backend/migrations/0001_atomic_chat_billing.sql` once using D1 migrations. The example Wrangler configuration declares the migrations directory. Do not reapply the ALTER statements by hand.
4. Compare each account's `reserved_credits` to the sum of its open reservation estimates. Reconcile any discrepancy with provider/ledger evidence. Do not zero counters to bypass the guard.
5. Provision approved price snapshots with effective and expiry timestamps, usage limits, correctly funded free/paid accounts and billing cycles. Add the single `chat_billing_policy` row with a reviewed positive budget; leave `enabled=0` until staging gates pass.
6. Connect and verify the metered provider gateway, origin, credentials, real usage/token limits, idempotency, billing behavior, privacy and reconciliation lookup. Validate authenticated staging requests and outages against the actual D1 database.
7. Activate only after user-visible quotas/pricing, alerts, provider controls and account backend are ready. Neither this PR nor deploying the frontend enables paid AI.

An old Worker using the legacy billing path must not be restored over this migrated schema. Roll back by disabling execution and restoring compatible code, while preserving the ledger and outstanding holds.

## Reconciliation and unresolved outcomes

The five-minute scheduled sweep processes at most 100 expired **never-dispatched** holds per run. It never automatically refunds started/unknown requests.

For a started/unknown request, obtain authoritative provider evidence using its durable request ID. Internal `settleChat()` can settle verified measured usage, or `releaseChat()` can release after confirmed zero billable usage. These functions are not exposed as client-controlled refund endpoints. No automated provider reconciliation adapter or operator reconciliation UI is implemented yet. Keep such holds and global budgets visible to operations before launch; never instruct users to repeatedly create fresh keys.

## Verification

`npm run verify:all` passed **149 tests**: 57 existing identity/API tests, 47 billing tests, 29 chat-execution tests, 15 browser-runtime tests and one local D1 integration test. The web bundle also passed its 22-route/critical-asset and core checks. Production dependency audit found zero vulnerabilities. These are local pre-production results; real paid-provider execution and production D1 were not exercised.

- Behavioral billing tests cover duplicate and distinct concurrent requests, account and global quotas, quote expiry, included/prepaid ordering, idempotent settlement/release, wrong-owner access, malformed usage, lost acknowledgements, rollback, cycle resets, legacy migration and stale-hold sweeping.
- Four separate worker threads with independent SQLite connections test real write contention, in addition to concurrent HTTP requests.
- Worker tests simulate successful, rejected, timed-out, malformed and ambiguous provider outcomes; no paid model API is called.
- Browser-runtime logic tests cover double submit, persisted retries, reloads, account changes, receipt recovery, safe-off and local-storage failure.
- A Cloudflare Miniflare D1 integration test applies the actual schema/migration and verifies trigger behavior, concurrency, settlement and rollback against the local Workers D1 runtime.
- `npm run verify:all` includes the new billing suite; the existing Firebase-rule suite remains a separate CI gate.

## Remaining work

Actual sign-in/account backend, audited model-provider gateway, provider reconciliation integration, encrypted reply recovery (if offered), priced/funded plans, payment webhooks, monitoring/alerts, staging D1 deployment and device end-to-end tests remain unfinished. Full chatbot streaming and cancellation UX are separate from this billing safety checkpoint.

## References

- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/
- https://sqlite.org/lang_createtrigger.html
