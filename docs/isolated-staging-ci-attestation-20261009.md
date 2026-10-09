# Exact-main CI attestation

Isolated staging re-audit now requires a read-only attestation that the same `main` commit passed Cloud runtime validation, Security policy gate, Native build validation and Pages deployment. Every run must be completed successfully against the exact head SHA.

This attestation only unlocks staging re-audit eligibility. It cannot authorize production activation, provider calls, billing changes or owner spend. The recorded commit remains safe-off and non-executing.
