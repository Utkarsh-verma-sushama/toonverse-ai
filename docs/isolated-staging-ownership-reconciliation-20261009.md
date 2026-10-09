# Isolated staging ownership reconciliation

Date: 2026-10-09

The read-only Cloudflare inspection now reconciles the existing staging inventory against the accepted private deployment receipt. It matches the three target D1 identities by name, UUID and role, confirms both target Worker names, confirms the pilot database is preserved, and requires the inventory to be complete and unique.

The reconciliation is fail-closed. Any identity drift, missing pilot, missing Worker, duplicate resource, unsafe deployment evidence, provider request, or remote write blocks ownership verification. A successful ownership result never authorizes provisioning, provider execution or production activation.

Current safety boundary:

- remoteChangesPerformed: false
- providerRequestsPerformed: false
- provisioningAllowed: false
- activationAllowed: false
- workers.dev/preview public endpoints remain disabled

The separate Workers Free-plan proof remains an independent gate. The existing account inventory may prove ownership without proving that the account is currently on the Free plan.
