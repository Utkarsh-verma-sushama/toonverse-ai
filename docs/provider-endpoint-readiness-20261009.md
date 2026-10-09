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
