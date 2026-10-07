# Bounded Gemini provider adapter — pre-production source checkpoint

Date: 7 October 2026. Provider source and local Worker/D1 integration are implemented.
Private isolated remote deployment, full schemas and fixture recovery/restart acceptance
are complete; see [verified deployment](../deploy/isolated-staging/verified-deployment.json).
Real Google traffic and production activation remain unaccepted. All committed
generation/audit flags are off. [Current public policy/pricing review](gemini-public-policy-review-20261007.md)
is complete as a documentation review, with live project/model/privacy/funding gates still open.

## Boundaries and token accounting

`backend/gemini-adapter.mjs` implements the existing gateway's bounded contract.
`POST /responses` requires `ADAPTER_DISPATCH_KEY`; `GET /receipts/{reservationId}`
requires a distinct `ADAPTER_RECEIPT_KEY`. Both are server-only URL-safe secrets of
32–256 characters. Configure the gateway's `GATEWAY_ADAPTER_DISPATCH_KEY` and
`GATEWAY_ADAPTER_RECEIPT_KEY` to the respective values; receipt access cannot generate.
The gateway reaches the adapter by its private Worker service binding. The committed
config has no public route, workers.dev or preview URL.

Generation requires an existing, unexpired application chat reservation in `started`
state, its exact canonical prompt hash/provider/model/token budgets, and the gateway's
existing durable dispatch claim. A unique adapter claim is persisted before any
upstream request. Agents, tools, extra provider options, caches and retention requests
are excluded. Kill switches and the active reservation/gateway claim are checked again
after preflight. Concurrent callers, restarts and ambiguous claim writes never create
a replacement generation request.

The model is explicitly configured and syntactically restricted to the Gemini 3 Flash/Flash
Lite family. The regex is not evidence that a model is audited or available to the
selected project; no model or price is selected by default. Google requests use the fixed
HTTPS API origin, API key header, redirect blocking, bounded response bytes and one
shared header/body deadline. There are no automatic retries or fallbacks.

Before generation, `countTokens` receives the **complete generation request**, including
role-mapped contents and generation controls. A reviewed token margin (default 32,
minimum 16) must fit inside the reserved input budget. `candidateCount=1`, thinking
level `low` and `maxOutputTokens` equal to the reserved output budget bound generation.
Google's response usage is validated as:

- Input = `promptTokenCount`.
- Output = `candidatesTokenCount + thoughtsTokenCount`.
- Total must equal input plus output; cached/tool input must be zero.
- Both original budgets and audited preflight drift headroom must hold.

Post-response accounting is a contract check, not a way to reverse upstream spend.
Preflight accuracy/headroom, combined thinking/output cap and selected model behavior
must be audited against the actual provider before activation. Model fixture names and
fixture prices are not live model availability or pricing evidence.

## Durable evidence and failure handling

`DB` is the isolated application billing DB; `GATEWAY_DB` is the separate gateway
receipt DB; `ADAPTER_DB` is a third isolated evidence DB. Apply
`backend/gateway/schema.sql` to the new adapter DB first, then
`backend/gemini-adapter/schema.sql`. Never apply these to the account pilot database.

The adapter retains only original request identity, immutable Google `responseId`, its
hashed metered record ID, measured input/output tokens and timestamps. It stores no
prompt or generated answer. Vendor evidence is committed before receipt finalization.
If evidence commit acknowledgement or the following receipt write is lost, GET projects
the committed evidence read-only, including while generation/API access is off.
Gateway operator recovery can consume this evidence without another generation call.

Pre-generation failures produce a durable zero-generation rejection. This relies on
an independently verified nonbillable count endpoint; its audit flag defaults off.
Failures after generation dispatch remain uncertain. Missing output with valid usage
still retains the billable receipt. Invalid usage/accounting/redirect contracts stop
adapter spending. Terminal receipts and vendor evidence cannot be changed or deleted
through ordinary operations.

**Remaining reconciliation limitation:** if the raw Google response is lost before
its authoritative usage/response ID is persisted, lookup reports `unknown`; it does
not query Google, infer no charge, release credits or re-run generation. A provider
billing/support evidence procedure is required before production acceptance.
Recovery reports billing evidence, not a missing answer.

## Deployment and acceptance gates

`deploy/gemini-adapter/wrangler.json` is the safe-off source template with three
placeholder database IDs. The accepted isolated runner generated a separate package
with verified actual IDs and deployed it privately; the template alone is not live
evidence. Keep application, gateway, adapter controls and confirmations off until their
separate activation gates pass.
Secrets belong in the secure server/CI credential store, never source or chat.

Required adapter gates are `GEMINI_GENERATION_ENABLED`, the adapter and gateway D1
controls, application billing policy, and four independently reviewed assertions:
`GEMINI_MODEL_PROFILE_AUDITED`, `GEMINI_PREFLIGHT_AUDITED`,
`GEMINI_COUNT_TOKENS_NONBILLABLE_AUDITED`, `GEMINI_PRIVACY_PRICING_AUDITED`.
Production additionally needs
`GEMINI_EXECUTION_CONFIRMATION=UVENARO_ENABLE_GEMINI_GENERATION`.
A true flag does not constitute audit evidence. Current provider pricing/privacy,
nonbillable token counting, zero-owner-spend/funded activation policy, monitoring,
retention, backup/restore and lost raw-response reconciliation remain live gates.

The resource/schema/private-secret and remote fixture smoke/restart/recovery steps are
complete. Next: resolve the project-specific evidence listed in the public policy review.
Real provider requests still require satisfied funding, privacy/pricing, age/region,
model/endpoint and operational gates. No background or scheduled AI is added.

Verification: 36 adapter behavioral/configuration tests plus actual gateway + adapter
Workers using three persistent D1 databases, scoped service credentials, concurrent
claims, measured thinking-token billing, process restart, immutable evidence, one-time
application settlement and persistent unknown outcomes. All Google traffic in tests
is intercepted by fixtures. `npm run verify:gemini-adapter-build` and the billing suite
are mandatory CI gates for the new revision. Bundle verification uses the pinned
local esbuild compiler and makes no Cloudflare deployment/API request. Local
Wrangler verification was initially blocked by automatic approval review due to potential
source disclosure. The owner subsequently approved the concrete upload; private
remote acceptance is evidenced by run 37589900190 and the linked receipt. Offline
bundle success alone is still not remote acceptance evidence.

Official API references: [GenerateContent usage and response identity](https://ai.google.dev/api/generate-content),
[countTokens request format](https://ai.google.dev/api/tokens),
[thinking levels and output budget](https://ai.google.dev/gemini-api/docs/thinking).
