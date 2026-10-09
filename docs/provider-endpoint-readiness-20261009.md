# Authenticated provider endpoint readiness

Date: 2026-10-09 (IST)

This stage adds a sanitized readiness contract for a future authenticated, read-only Gemini inspection. It binds a provider credential by name and SHA-256 digest only; no API-key value is accepted or stored.

The evidence contract requires:

- exact Gemini project ID and project number binding, with a dated Free/no-billing observation;
- explicit per-secret acknowledgement, live binding readback and bounded propagation retries;
- the exact non-redirecting HTTPS endpoint and a model profile exposing only the reviewed `countTokens` and `generateContent` methods;
- authoritative nonbillable `countTokens` receipt-GET evidence with no prompt, answer or raw provider response;
- privacy/store=false, no background execution, zero owner-spend, no auto-top-up and no paid requests;
- generation, provider requests and activation disabled at the readiness boundary.

The module validates evidence only. It does not read a key, contact Google, select a model, enable billing, provision resources or activate production. Missing, stale, future-dated, malformed or secret-bearing evidence fails closed. A complete record is still readiness evidence—not permission to execute AI.

## Sanitized probe result

A manual GitHub Actions read-only probe completed successfully in run \`37933842349\` (job \`113830865150\`) at 18:31:23 IST on 9 October 2026.

- \`models.list\` found \`gemini-3.8-flash\` with \`countTokens\` and \`generateContent\` capability metadata.
- \`countTokens\` returned 13 tokens; the probe made no \`generateContent\` request.
- Redirect blocking and HTTPS endpoint checks passed.
- The key fingerprint was recorded only as SHA-256 metadata; the key value was not logged or stored.
- Project binding/readback, tier binding, bounded propagation acknowledgement and authoritative receipt-GET remain unverified, so the readiness status remains \`PROVIDER_ENDPOINT_READINESS_UNVERIFIED\`.

The sanitized receipt is stored at \`deploy/provider-acceptance/gemini-project-probe-receipt-20261009.json\`. It is evidence only and cannot authorize provider use, billing or activation.
