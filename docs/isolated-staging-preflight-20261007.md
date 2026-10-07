# Isolated Cloudflare staging — permissions and safe-off bundle checkpoint

Date: 7 October 2026. Base provider checkpoint main
`4eeff9741c55302c8ef56952c8b637c3494cba10` passed Security #306, Cloud #524,
Native #553 (Android/iOS) and Pages #552. Production/provider generation remains off.

## Actual remote preflight

The existing GitHub environment ran the new inspection on
`377b2bc59c4f6bcd3b58a1d440987619d8890357`.
[Read-only workflow](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/37578967568).

| Observation | Result |
| --- | --- |
| Existing token | Active |
| Complete D1 inventory | Readable; one existing database |
| Existing account pilot | Identity verified and preserved |
| Proposed three database names / two Worker names | No collisions |
| Free-plan database count capacity | Three slots fit the current documented count limit |
| Token policy details / declared account write scopes | Not inspectable |
| Explicit current Workers Free plan | Not verified |
| New remote resources / paid provider requests | None |

The two blockers are `TOKEN_SCOPE_METADATA_UNAVAILABLE` and
`WORKERS_FREE_PLAN_UNVERIFIED`. Missing metadata does **not** establish that the
actual token lacks Worker/D1 writes, nor that the account is paid. Readable existing
resources do not establish new-resource write permission. No automatic resource
creation, account upgrade, token creation/rotation or paid SKU selection is attached
to this workflow.

The latest inspection also reports sanitized metadata error categories and token
kind without revealing token/account/database identifiers or provider response bodies.
Inventory truncation, wrong pilot identity, existing target resources, denied/foreign
or individual Worker scopes, paid/unrelated/empty subscription results and missing
settings all block provisioning. An existing target is not automatically adopted or deleted.

## Source/binding/migration preparation

`scripts/prepare-isolated-staging.mjs` creates the two compiled Worker bundles,
safe-off configurations, ordered schema chains and a SHA-256 artifact manifest.
`npm run verify:isolated-staging-build` builds fixture artifacts locally; it makes
no Cloudflare request or provider request. `.isolated-staging` output is ignored by git.

The bundle includes all eight application baseline/migration files, the isolated
gateway receipt schema and the adapter base/evidence schemas (11 SQL files total).
SQL is normalized to LF, preserving trigger bodies. It also includes two bundles
and two JSON configurations. No server secrets are present. Source generation/audit
assertions, paid confirmations, workers.dev, preview URLs and observability remain off.

For a future concrete build, secure server-side inputs are:
`UVENARO_CHAT_STAGING_DATABASE_ID`, `UVENARO_GATEWAY_STAGING_DATABASE_ID`,
`UVENARO_ADAPTER_STAGING_DATABASE_ID` and the existing pilot ID used only as an
exclusion guard. All three target UUIDs must be distinct and different from the pilot;
fixture IDs cannot be accepted as remote bindings. Actual database names/identities
must be checked against fresh Cloudflare metadata before any remote application.

A manifest is review evidence, not a permission grant or remote deployment command.
It explicitly states `remoteDeploymentAuthorized=false` and lists the remaining
exact-main CI, fresh Cloudflare preflight, actual binding identity and secret scope gates.

## Local fixture smoke test

Actual local gateway and adapter Workers load the **generated bundles** with three
persistent D1 databases initialized from the **exact generated migration artifacts**.
Fixture-only provider/model settings and independent dispatch/read keys are supplied
to the local test; no actual vendor model is selected for deployment.

The smoke checks demonstrate both HTTP credential boundaries, blocked generation,
authenticated completed receipt reads while generation is off, read-only projection
of committed adapter evidence, process disposal/restart persistence and zero outbound
requests. The billing database creates no usage reservation in this safe-off smoke.
Separate existing provider integration tests continue to exercise full fixture generation,
preflight, thinking-token usage and one-time settlement. No live remote end-to-end
smoke success is claimed while resource/plan gates remain unresolved.

`npm run verify:all` now registers 594 local tests: previous 569 plus 18 metadata/
isolation regressions and 7 bundle/real-Worker smoke tests. Mandatory Cloud CI also
builds the prepared fixture package. Exact-revision CI must pass before accepting
this source checkpoint.

## Owner-controlled access step and next execution

The existing token can read the pilot but cannot currently supply the metadata needed
for a zero-owner-cost provisioning decision. Token policy inspection requires the
appropriate **API Tokens Read** permission (User or Account, matching token kind),
and subscription inspection requires **Billing Read**, restricted to the selected
Cloudflare account. These are read permissions; neither API Tokens Write nor Billing
Write is requested. Keep current required Worker/D1 permissions, without widening to
unrelated accounts. Edit the existing token in the secure dashboard; do not paste it
into chat. Only if the token is replaced must its secure GitHub environment secret
be updated.

Once metadata is readable, rerun the access workflow. If the Free plan cannot be
established from authoritative subscription data, the remaining requirement is an
owner-verified current plan record; no automatic paid-plan upgrade is permitted.
If declared new-resource writes are insufficient, resolve only those exact scopes.
Then provision the three isolated databases, validate identities, apply the correct
schema chains, configure separate server secret scopes, deploy safe-off Workers and
perform the remote fixture smoke/rollback procedure. Preserve the existing account pilot.

Official references:
[User token policy read](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/get/),
[Account token policy read](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/get/),
[Account subscriptions](https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Access update after owner token edit

On 7 October the owner updated `Uvenaro Staging Deploy 2`, retaining the selected
account and D1/Workers Scripts Edit and adding Billing Read and User API Tokens Read.
The existing GitHub environment's read-only rerun then verified an active user token,
inspectable policies, declared new-Worker and D1 write scopes, and the unchanged pilot.
The token-policy metadata blocker is resolved; no token value was revealed or rotated.

Subscription inspection now uses the documented query-free SinglePage request.
The SDK permits omitted `result_info`; when supplied, a matching integer total remains
mandatory. Empty results, paid/unrelated plans, trial/inactive states or inconsistent
totals never authorize provisioning. HTTP diagnostics expose only status and bounded
integer error codes. Free-plan acceptance still requires explicit current Workers
Free evidence. No plan upgrade, new remote resource or provider call is part of this check.

[Official SinglePage contract](https://developers.cloudflare.com/api/typescript/resources/accounts/subresources/subscriptions/methods/get/).

## Owner Free plan evidence and database-only operation

At 12:22 IST on 7 October, owner screenshots `1000053856.jpg` and
`1000053857.jpg` show **Workers plans → Free → $0 → Current plan**.
Earlier account-overview screenshots `1000053854.jpg`/`1000053855.jpg` bind this
dashboard context to account `fc3da7a1c1263e601d03d222b7d1e155`.
The owner proof is complete. Earlier requests for another plan screenshot are
superseded; API subscription proof remains unknown and is not reclassified.

The resource-only request is account-bound and expires within six hours of the
owner observation. It may resolve only a successful empty subscription inventory;
paid, nonempty uncertain, denied or failed metadata cannot be overridden.
Security, Cloud runtime and Android/iOS Native CI on exact current main must pass
before writes and are rechecked before each database creation.

`scripts/provision-isolated-databases.mjs --remote` creates exactly the three named
empty D1 databases using APAC location hint and disabled read replication. It reads
back every UUID/name, preserves the pilot, verifies complete inventory and capacity
before each create, and records durable intent before each single POST.
Ambiguous outcomes, identity mismatch or concurrent inventory/main changes stop
without retry, delete or adoption of a preexisting resource. Automatic workflow
reruns cannot repeat writes; a new reviewed resource request is required.

The request-specific workflow retains a sanitized journal on success/failure.
After creation it compiles local Worker/config/schema files against the three
confirmed IDs. This operation uploads **no SQL and no Worker source to Cloudflare**,
does not change secrets, plans, payments, routes, providers or the existing pilot,
and permits no real AI call. Worker/schema upload and remote acceptance remain the
next deployment operation; offline preparation does not claim deployment.

## Explicit owner upload authorization and execution

At 12:49:30 IST the owner explicitly approved the prepared upload and continuing work:
“मेरी पूरी अनुमति है तुमको, काम चालू रखो।” The earlier source-disclosure approval
pause is resolved for this concrete isolated schema/Worker package. This does not
authorize a paid plan, provider calls, background AI or public launch.

The request-specific upload workflow requires exact current-main CI before every
mutation and preserves a sanitized durable journal. It verifies the three owned UUIDs,
unchanged pilot, complete inventory, current plan evidence and absence of target Worker
collisions. The full schema chain is applied by file, including intact trigger bodies;
each schema stage must exactly match the local SQLite object fingerprint before advancing.

Four independent server credentials are generated in the secure runner and uploaded
without persistence in files/artifacts. Gateway adapter credentials match the corresponding
adapter dispatch/read scopes. No vendor API key is configured. A temporary bearer-authenticated
probe can call only fixed private services and fixture IDs. It verifies cross-key denial,
disabled generation, completed receipt reads, evidence projection, explicit one-time recovery,
repeat recovery, process/version redeployment persistence, empty usage reservations and disabled
database controls. Its fixture model is temporary metadata and is never called upstream.

The final upload restores blank provider/model settings, all activation flags off and no
public/preview endpoint on the two target Workers. Live settings/bindings/deployment identities
are read back, the probe checks final safe-off behavior and is deleted. The existing pilot
is neither migrated nor redeployed. Immutable test receipts retain their explicit fixture IDs.
Ambiguous mutating outcomes stop without blind retry; only the successfully created temporary
probe is eligible for scoped cleanup.

[Official D1 creation contract](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/).


## Completed remote database-only acceptance — 7 October, 12:36 IST

Exact source commit `bfd34b5ca5391fae31642b4740750c3b4e0406ce` passed Security #318,
Cloud #536, Native #565 (Android and iOS individually) and Pages #557. All 616
registered local tests passed. Resource preparation run 37585091996 then succeeded.

| Database role | Verified name | Actual UUID |
| --- | --- | --- |
| Application billing/reservations | uvenaro-chat-staging | 861c33bd-a2a1-4e34-9ab2-0b430e6d948c |
| Gateway receipts | uvenaro-gateway-receipts-staging | 0ca7dfdf-e6f7-45ee-bbf9-9903036d6f4d |
| Adapter evidence | uvenaro-adapter-evidence-staging | 48577dbd-14e0-4529-8b95-f073f4fb228d |

Each single create response was checked against a metadata readback. Final complete
inventory confirms all three identities plus the unchanged account pilot. D1 writes
are now exercised; new-Worker writes are still only declared. No SQL, Worker source,
provider request, secret rotation, plan upgrade or payment change was performed.

Artifact 11465309090 contains the durable create journal and 15 fingerprinted files
compiled against the real IDs. Its GitHub SHA-256 digest and every manifest fingerprint
were verified after download, including private endpoints and disabled generation,
audit, recovery, observability and paid confirmations. The persistent repository
identity receipt is `deploy/isolated-staging/verified-databases.json`; it is evidence,
not an authorization grant or permission to adopt an arbitrary preexisting name.

Next: prepare the reviewed Worker/schema upload, independent server secrets and a
private fixture-only remote acceptance/recovery procedure. An earlier automatic approval
review rejected the source-upload/dry-run action because it could disclose the adapter
source to Cloudflare. This completed run used the materially safer database-only
operation. Source/schema upload remains pending explicit owner acknowledgement of
sending the concrete prepared package to Cloudflare; real provider execution remains off.
