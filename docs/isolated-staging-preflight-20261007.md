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
