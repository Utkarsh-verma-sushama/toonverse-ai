# Uvenaro metered gateway server and durable receipts

Date: 7 October 2026. Scope: gateway Worker, independent durable receipt database,
authenticated generation/lookup and explicit operator recovery. Source and local
staging runtime are implemented; no remote Worker or real vendor adapter is deployed.
Paid AI and remote generation remain disabled.

## Request and spending boundaries

`backend/metered-gateway.mjs` serves two routes:

| Route | Credential | Behavior |
| --- | --- | --- |
| `POST /responses` | `GATEWAY_DISPATCH_KEY` | Validate and claim one existing application reservation before bounded adapter dispatch |
| `GET /receipts/{reservationId}` | `GATEWAY_RECEIPT_KEY` | Read only the existing durable billing receipt; never generate |

Both credentials must be independent 32–256 character URL-safe secrets. Configure
them server-side only. The response/receipt credentials correspond to the app's
`CHAT_PROVIDER_API_KEY` and `CHAT_RECEIPT_API_KEY`. No cookies, frontend credentials,
caller-supplied owner/credits or public refund/recovery endpoint are accepted.
Receipt lookup remains available with generation off. Every response is no-store.

Generation requires `GATEWAY_GENERATION_ENABLED=true`, an enabled dedicated D1
gateway control and enabled application billing policy. Production additionally
requires `GATEWAY_PAID_EXECUTION_CONFIRMATION=UVENARO_ENABLE_PAID_GATEWAY` and an
audited `bounded-metered-v1` provider adapter service binding. Repository examples
leave execution, audit assertion and recovery off. These declarations are gates,
not evidence that the real adapter has been reviewed.

The request must identify an existing, unexpired `started` application reservation
whose immutable provider/model/token limits match exactly. The gateway recomputes
the application's canonical request hash, including owner and normalized messages,
and refuses changed input. Agent reservations are excluded. A request cannot choose
a different provider, increase its reserved budget, enable tools or request retention.
Application D1 guards remain the authority for credits, quotas and global spend.

## Durable state and recovery

`backend/gateway/schema.sql` belongs in a dedicated **isolated staging receipt DB**,
separate from the application's billing DB. It starts with generation control off.
A unique reservation ID atomically claims dispatch before any provider call. Lost
claim acknowledgement causes no dispatch. Concurrent requests and post-restart retries
never take another generation claim. There are no leases or automatic re-dispatch.

Receipt states are `dispatching`, `unknown`, `completed` or `rejected`. Immutable
bindings include request hash, provider/model, token ceilings and creation time.
Terminal evidence cannot be rewritten or deleted through ordinary operations.
Stored metadata contains no prompt or generated answer. An original successful
response includes the answer; a duplicate request does not replay it. Existing app
receipt recovery reports charges rather than claiming to recover a missing answer.

The gateway validates measured tokens, exact request/provider/model identity,
authoritative provider record ID and unambiguous billing outcome. A proven pre-dispatch
kill-switch rejection produces a durable zero-usage no-charge receipt. Network errors,
redirects, malformed/oversized/stalled responses and ambiguous evidence preserve an
uncertain claim; contract violations also disable the durable gateway spending control.
Body and header deadlines are bounded even when a service ignores cancellation.

`recoverGatewayReceipt(env,id)` is an explicit server/operator function with no
HTTP or scheduled route. Enable it separately; production needs
`GATEWAY_RECOVERY_CONFIRMATION=UVENARO_RECOVER_GATEWAY_RECEIPTS`. It fetches an
existing adapter receipt by GET and can finalize uncertainty while generation is off.
A missing, pending or malformed adapter record cannot authorize a release. Recovery
never sends the original prompt or creates another paid request.

The application [receipt integration](chat-gateway-receipts.md) reads the durable
gateway receipt and uses existing atomic settlement/release. The two databases do
not share a transaction: uncertainty across either persistence boundary is retained
and reconciled; it is never treated as a free retry or an automatic refund.

## Required provider adapter service

The only outbound integration is the configured `PROVIDER_ADAPTER` Worker service
binding. It accepts the bounded `metered-v1` request at `POST /responses` and returns
HTTP 2xx with a final, validated envelope, including exact usage and output for success.
Zero-charge rejection also returns an explicit final envelope over HTTP 2xx.
`GET /receipts/{originalReservationId}` supplies durable authoritative final evidence
without creating billable work. Neither a 404 nor absence of a vendor record proves
that a request was not charged.

Before any real vendor activation, the adapter must enforce the **actual input token
ceiling before vendor spend**, output ceilings, no retries/fallback duplicate spend,
reviewed pricing/token semantics, durable request identity and read-only nonbillable
receipt retrieval. A provider response discovered over budget trips the gateway stop;
it cannot undo vendor spend, so post-response validation does not substitute for the
adapter's pre-dispatch token/cost enforcement. Vendor implementation/audit remains open.

## Verification

- `npm run verify:all`: 521 passing local tests, including 32 new gateway tests.
- Actual local Cloudflare Worker/D1 test: concurrent dispatch claims once, then
  process disposal/restart preserves a completed receipt and a lost application
  reply reconciles exactly once without another generation POST.
- Failure tests: distinct credential scopes, independent confirmations, request hash
  and token budget tampering, kill switches, lost claim/final DB acknowledgement, unknown outcomes,
  operator-only recovery, bad evidence, redirects, body/header deadlines and immutable
  receipt constraints.
- `npm run verify:metered-gateway-build`: Wrangler bundle/deploy dry run passes with
  safe-off settings. Cloud runtime CI now requires this build, and Security CI runs
  the gateway regressions and syntax check. New-revision CI still gates phase acceptance.

These are fixture-based local/runtime tests, not proof of a real vendor audit or live
staging activation. No external model requests or funding/payment changes occurred.

## Remote staging procedure and outstanding gates

The safe-off configuration is `deploy/metered-gateway/wrangler.json`. Remote execution
was unavailable in this session: Cloudflare token/account access and concrete isolated
database bindings were not present. No placeholder ID was deployed.

Before remote staging, provide authorized Cloudflare access, create/verify isolated
billing and receipt databases, apply their correct schema/migration chains, configure
independent server secrets and bind the reviewed adapter. The existing account pilot
database must not be repurposed automatically. Keep gateway/app generation and paid
confirmations off while validating database isolation, secret scopes and receipt reads.
Run a fixture-only remote smoke test before introducing any real vendor traffic.

Production additionally needs provider token/pricing audit, monitoring/spend alerts,
backup/restore and rollback drills, receipt retention/privacy policy and authorized
activation. Append-only receipt deletion requires an explicitly reviewed retention
operation; ordinary deletion is deliberately blocked. Official Launch remains open.
