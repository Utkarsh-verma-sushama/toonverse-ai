# Fixture-only provider readiness pass

The next readiness stage verifies the isolated staging shape without provisioning production or calling a provider. It requires schemas, private bindings, smoke/restart/recovery/rollback drills, and explicit safe-off controls.

The pass rejects generation, paid confirmation, API-key presence, external provider calls, public endpoints, background AI, and unknown outcomes that are not fail-closed. A successful fixture pass is not activation permission; it only proves that isolated staging can be prepared safely.
