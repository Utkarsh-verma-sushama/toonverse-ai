# Provider acceptance evidence and reconciliation drill

Date: 2026-10-09

This checkpoint records the sanitized, read-only provider evidence used by the Uvenaro staging acceptance gate.

- Project binding is verified for `toonverse-ai`.
- The observed Gemini tier is Free and billing is not configured.
- Provider generation and provider requests remain disabled.
- No API key, prompt, answer, or provider response is stored in this bundle.
- Model profile, pricing, privacy, usage-accounting, and operations evidence remain explicit blockers until verified from authoritative sources.

The fixture-only drill proves the boundary between these states:

1. Acceptance evaluation keeps generation disabled while required evidence or authorization is missing.
2. A previously dispatched request can be reconciled through a read-only authoritative receipt lookup.
3. The receipt lookup is a single GET with no request body and no automatic provider retry.
4. A completed billable receipt settles the reserved amount exactly once.

This drill does not call Gemini, change billing, activate a public endpoint, or authorize production execution. A live-provider acceptance run requires fresh model/pricing/privacy/usage/operations evidence and an explicit operator authorization.
