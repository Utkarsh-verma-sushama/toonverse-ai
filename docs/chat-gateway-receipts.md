# Metered chatbot gateway — operator receipt integration

Date: 7 October 2026. Engineering scope: authenticated read-only receipt retrieval
and settlement/release of existing uncertain chat holds. The metered gateway
server and vendor adapters are not deployed by this change. Production AI stays off.

## Operator boundary

`backend/chat-gateway-reconciliation.mjs` exports `reconcileChatFromGateway`.
Only trusted server/operator code may call it. There is no public Worker route,
scheduled reconciliation, retry loop or generation dispatch. Agent reservations
are excluded because they require their separate reconciliation authorization.

Enable receipt lookup explicitly with `CHAT_RECEIPT_LOOKUP_ENABLED=true`; production
also requires the existing independent `CHAT_RECONCILIATION_CONFIRMATION`.
Store `CHAT_RECEIPT_API_KEY` as a server secret scoped to read-only receipts.
`CHAT_RECEIPT_BASE_URL` is the canonical HTTPS collection URL without a trailing
slash, query, fragment or credentials. It must pass the same allowed-origin and
production audited/pinned-origin rules as generation dispatch. Raw vendor hosts
are forbidden in production. `CHAT_RECEIPT_TIMEOUT_MS` defaults to 10 seconds and
must be an integer between 100 and 30,000 ms. Examples remain safe-off.

Lookup stays available while paid generation and billing are disabled, so operators
can resolve already-dispatched work after an emergency stop without enabling spend.
The stored reservation's price-snapshot provider/model must match the configured
gateway provider/model; configuration drift fails closed before network access.

## Required receipt contract

The operator sends `GET {CHAT_RECEIPT_BASE_URL}/{reservationId}` with a read-only
Bearer credential and `Accept: application/json`. No prompt, owner ID, credit
amount, tools, generation body or client-supplied usage is sent. The gateway must
provide a durable, nonbillable lookup of its existing record. The read-only credential
must not permit generation; this property requires deployment verification.

Successful lookup returns HTTP 2xx and JSON no larger than 16 KiB:

```json
{
  "protocol": "metered-v1",
  "request_id": "original-reservation-uuid",
  "provider": "configured-provider",
  "model": "configured-model",
  "id": "authoritative-provider-record-id",
  "status": "completed",
  "billable": true,
  "usage": {"input_tokens": 10, "output_tokens": 5}
}
```

For verified no-charge rejection, use `status: rejected`, `billable: false` and
both token counts equal to zero. A missing/pending receipt, 404, transport error,
redirect, malformed/oversized/stalled response, identity mismatch, ambiguous billing
or invalid usage never releases a hold. A claimed no-charge response with nonzero
usage is rejected. Gateway receipts must originate from the reviewed gateway's
durable provider evidence; the payload alone is not proof of a vendor audit.

The integration uses existing atomic settlement/release and immutable price
snapshots. Concurrent operator calls cannot settle twice; retries after finalization
fail before lookup. Response text, generation output, URLs and secrets are not
returned in errors. No conversation output is stored or recovered here.

## Verification and remaining dependency

The billing suite includes 32 behavioral receipt tests: settlement with paid AI off,
no-charge release, mismatched receipts, permission/config failures before network,
separate agent authorization, HTTP/network failures, redirect protection, size/body
deadline handling and concurrent single-charge ledger enforcement. Existing dispatch
tests also exercise the extracted shared route validation.

The [gateway server and durable store](metered-gateway-server.md) are now implemented
and tested in actual local Worker/D1, including restart and lost-response reconciliation.
The [bounded adapter source](gemini-provider-adapter.md) is now implemented and
tested locally. Remote staging deployment and the live provider audit remain open.
Validate provider token/cost accounting and read-only lookup permissions before real
vendor access or paid execution; no credentials or production activation are created.
