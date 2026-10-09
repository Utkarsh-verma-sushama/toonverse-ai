# Provider activation review boundary

Date: 9 October 2026 (IST)

The acceptance audit now has a second, read-only review boundary in
`backend/provider-activation-review.mjs`.

It protects the transition between evidence collection and any future operator
authorization:

- every gate must carry dated observations;
- each gate has a bounded freshness window;
- stale, missing, future-dated or malformed observations fail closed;
- the current safe-off bundle cannot become activation-ready;
- a complete fresh fixture reaches only the explicit-authorization boundary;
- execution requires a structured authorization record containing operator identity,
  approval time, exact `provider-generation` scope and a reason;
- no function in this review module makes a provider request, changes billing,
  enables a public route or starts a background job.

This is a review/readiness layer, not an activation command. Live provider enablement
remains separately controlled and requires fresh authoritative model, pricing, privacy,
usage, reconciliation and operations evidence.
