# Official Gemini evidence checkpoint

Date: 9 October 2026 (IST)

The repository now records a sanitized ledger of the official Google documentation
review in `deploy/provider-acceptance/official-evidence.json`.

The review confirms documentation-level facts:

- Google recommends the Interactions API for new development; `generateContent`
  remains supported but is treated as legacy for this checkpoint.
- Interactions can retain state by default, so Uvenaro must explicitly use
  `store=false` and keep background execution disabled when this provider is ever
  admitted.
- Official billing documentation identifies input, output, cached-token count and
  cached storage duration as billing dimensions.
- Official usage documentation exposes input, output, thought, cached, tool-use and
  total token fields for accounting.

These are documentation findings, not project authorization. Project-specific model
endpoint access, pricing binding, policy enforcement, quota headroom, alerts and live
rollback remain unverified. Therefore the ledger deliberately remains
`SAFE_OFF_PENDING`; it contains no key, prompt, answer or live provider response.
