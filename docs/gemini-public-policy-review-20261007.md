# Gemini public policy and pricing review — 7 October 2026

Status: public documentation reviewed; provider production acceptance remains blocked. This review made no authenticated Google request, model execution, Cloudflare write, billing change or secret read. Checkpoint 43 stays locked; checkpoint 44 stays open.

## Engineering decision

Keep the deployed gateway/adapter blank-model and safe-off. Do not use a public free-tier price as evidence that private user content is suitable for that tier, or that the owner's Google project has that plan. Do not enable billing, purchase credits, configure auto-reload or make an audit test call under the zero-owner-spend-before-public-launch constraint. Public research is complete for this review; account, funding and actual endpoint acceptance are separate unfinished gates.

## Primary evidence

Reviewed current official pages on 7 October 2026; evidence is a dated observation, not a permanent pricing guarantee.

| Finding | Source | Release implication |
| --- | --- | --- |
| Unpaid API inputs/outputs may be used for product improvement and human review; sensitive/confidential/personal input is excluded by the terms. | [Gemini terms, effective 23 March 2026](https://ai.google.dev/gemini-api/terms) | No unpaid private-user-data route is accepted. |
| Paid-service prompts/responses are not used for improvement, but abuse/security/legal processing retains data for a limited period. | [Gemini terms](https://ai.google.dev/gemini-api/terms) | No zero-retention claim; exact project handling, period and disclosures remain to verify. |
| API clients likely used by under-18s are restricted; EEA/Switzerland/UK API clients require paid services. | [Gemini terms](https://ai.google.dev/gemini-api/terms) | The provider-specific age/region policy must be enforced before routing; the current general children clause is insufficient evidence. |
| Gemini prepay has a minimum $5 purchase and possible delayed overage; project caps are experimental and may lag around ten minutes. | [Billing](https://ai.google.dev/gemini-api/docs/billing) | Provider dashboards/caps cannot replace application reservations and hard pre-dispatch ceilings. No purchase is authorized here. |
| Cloud welcome/trial credit is not a general Gemini funding guarantee; the billing page has eligibility/date qualifications. | [Billing](https://ai.google.dev/gemini-api/docs/billing) | Actual project funding must be evidenced independently. |

## Dated model/price observations

Standard API USD prices per one million text tokens, excluding tax, currency conversion, tools, caching, batch/flex/priority and other media. These are observations for comparison; no model or price snapshot is installed.

| Public model ID | Input | Output, including thinking | Published validity observed |
| --- | --- | --- | --- |
| gemini-3.8-flash | $0.75 | $3.75 | Through 31 December 2026; $1.50/$7.50 from 1 January 2027 |
| gemini-3.5-flash-lite | $0.30 | $2.50 | Current page; recheck before activation |
| gemini-3.1-flash-lite | $0.25 | $1.50 | Text input; recheck before activation |

Source: [official pricing](https://ai.google.dev/gemini-api/docs/pricing). Free token columns do not override the data-use terms. Immutable production price snapshots must have explicit expiry before an announced price change, exact model/tier/modality, reviewed currency/unit conversion and reservation rounding. No default price or free budget is created.

The [catalog](https://ai.google.dev/gemini-api/docs/models) and [3.8 Flash model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) list the stable model ID and low thinking support. This is public catalog evidence only; staging fixture acceptance did not demonstrate account access or actual vendor behavior. The adapter's model regex is a syntax restriction, not an audited allowlist or selection.

## API contract still requiring acceptance

The adapter currently uses fixed `v1beta/models/{model}:countTokens` and `:generateContent` endpoints, a complete generation request for preflight, low thinking, one candidate and reserved `maxOutputTokens`. Official [countTokens API](https://ai.google.dev/api/tokens) and [generateContent API](https://ai.google.dev/api/generate-content) remain the relevant contract references. The public [thinking guide](https://ai.google.dev/gemini-api/docs/thinking) now emphasizes Interactions API fields; those cannot be substituted for the adapter's existing response schema without an implementation review.

Remaining evidence: explicit nonbillable count endpoint assurance for the selected project/model; real preflight-vs-generation drift; combined output/thought ceiling and usage identity; retention/subprocessor/location/deletion terms; authoritative billing evidence when a raw response is lost. Model execution is not required or performed to complete this public-document review. Any later acceptance call must first satisfy privacy, funding and owner-spend boundaries.

## Status and next implementation boundary

| Gate | Current status |
| --- | --- |
| Isolated schema, private scopes, fixture recovery/restart | Accepted in `deploy/isolated-staging/verified-deployment.json` |
| Current public terms/catalog/pricing research | Reviewed in this document |
| Actual Google project/model/tier and paid-service data treatment | Unverified; no credentials or billing session examined |
| Nonbillable count and selected live model profile | Unverified; fixture results are not vendor evidence |
| Production price/funding, age/region enforcement and privacy disclosures | Not installed/accepted |
| Live generation and four provider audit assertions | Remain disabled in committed configuration |

Next: bind an exact project/model/endpoint/data policy and dated price evidence to the release audit, then verify funded activation and policy enforcement without owner spending. A complete public review cannot automatically set `GEMINI_PRIVACY_PRICING_AUDITED`, `GEMINI_MODEL_PROFILE_AUDITED`, `GEMINI_PREFLIGHT_AUDITED` or `GEMINI_COUNT_TOKENS_NONBILLABLE_AUDITED` to true.
