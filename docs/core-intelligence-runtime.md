# Core Intelligence Runtime

This checkpoint adds the production-oriented foundation for three ecosystem capabilities.

## Autonomous agents

Agent execution is server-owned and resumable. Every run has a bounded step, time and cost budget; an idempotency key; cancellation; durable steps; explicit human approval for delete, publish, share, send, purchase, external-write and account changes; tenant-scoped records; and an append-only audit contract. Unbounded self-recursion and silent high-impact actions are prohibited.

## Multimodal model routing

The browser declares task, modalities and user constraints. The backend selects only capability-compatible models and scores health, quality, latency and cost. Privacy and region constraints filter candidates before scoring. Each route is short-lived, contains bounded fallbacks, and returns provenance. Provider keys and the provider catalog never enter the browser.

## Cloud runtime

The Worker contract supports authenticated edge APIs, D1 durable state, Queue-backed agent work and R2 media bindings. CORS is allowlisted. Feature flags remain off until real bindings, identity verification, provider catalog, monitoring and rollback are configured.

## Required supporting layers

Included: least-privilege tool allowlists, approval gates, budgets/quotas, idempotency, cancellation, tenant isolation, audit/provenance, privacy/region policy, bounded fallback, kill-switch-ready flags, health reporting and CI contract verification.

Deferred intentionally: provider-specific adapters, production credentials, live DNS, paid cloud resources, real worker consumers and SLO alert destinations. Those require owner-controlled accounts and cannot be truthfully activated from source code alone.
