# Uvenaro — Future-proof provider contract charter

Status: active architectural rule from 9 October 2026.

This charter governs every provider-related change already accepted and every future
ecosystem step. It does not promise that unknown future vendor APIs will never require
code updates; it makes those updates additive at a stable boundary instead of forcing
changes through account, billing, quota, receipt, privacy or UI layers.

## Stable layers

1. **Product capability contract** — the app requests a versioned capability such as
   `chat_v2`, image understanding or video conversion. It never chooses a vendor URL,
   key or price.
2. **Metered gateway contract** — `bounded-metered-v1` owns reservation identity,
   quotas, token ceilings, durable receipts, settlement and reconciliation. This layer
   remains provider-neutral.
3. **Provider contract registry** — each provider/model family is an immutable,
   versioned profile containing supported methods, capability limits, usage-field
   mapping, safety controls and required audit flags. The first profile is
   `google-gemini`; see `backend/provider-contract.mjs`.
4. **Adapter boundary** — an adapter translates one provider profile into the stable
   gateway envelope. New models/providers add a profile or adapter; they do not change
   application credit accounting or receipt semantics.
5. **Operational evidence** — model availability, pricing, privacy, retention,
   non-billable preflight, region/age rules and lost-response reconciliation are dated
   acceptance evidence. Fixtures and public documentation never silently become live
   acceptance.

## Extension rules

- New capabilities are additive and start disabled.
- New provider profiles must declare input/output/total ceilings, complete usage
  accounting, nonbillable preflight behavior, retry policy, privacy/retention scope,
  and a rollback/kill-switch path.
- Unknown providers, models, methods, response fields and capability combinations fail
  closed; they are never guessed or silently downgraded.
- Provider-specific secrets stay in secure runtime bindings. No key, token, prompt or
  generated answer enters source, logs, fixtures or evidence.
- Schema changes use versioned migrations and preserve old receipt readability.
- Every profile ships with contract tests, malformed-input tests, concurrency/restart
  tests, uncertainty/reconciliation tests and mandatory Security, Cloud, Native and
  Pages CI.
- Production activation requires explicit, independently reviewed gates. A provider
  key, a Free-tier dashboard and a passing fixture suite are prerequisites, not an
  activation grant.

## Five-to-ten-year compatibility goal

The core ecosystem is deliberately insulated from vendor churn:

- model IDs and vendor endpoints live only in the profile/adapter boundary;
- capability negotiation allows newer modalities without changing old clients;
- stable envelopes preserve old receipts and quota semantics;
- feature flags and versioned contracts permit parallel migration and rollback;
- deprecated profiles can remain readable while a newer profile is introduced.

This is the Uvenaro change policy for all future stages: prefer additive, versioned,
backward-compatible boundaries; never make an unreviewed provider change in the
billing, identity or public client core.
