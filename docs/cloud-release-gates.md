# Cloud release gates

Account authentication, cloud and AI execution flags remain disabled until their applicable gates pass. See [Account Backend](account-backend-checkpoint.md) for account-specific migrations, cookie transport and provider validation.

- Identity: managed account sessions, server-held Firebase JWT verification, live provider/revocation/recovery tests, tenant derivation and role/entitlement checks.
- Data: D1 migrations, backup/restore drill, retention deletion and tenant-isolation tests.
- Media: private R2 buckets, signed URLs, malware/MIME validation and lifecycle rules.
- Agents: queue consumer, dead-letter queue, step/time/cost quotas, approval expiry and emergency kill switch.
- Routing: at least two audited provider adapters, encrypted secrets, health probes, circuit breakers, fallback tests and no-retention verification.
- Operations: structured logs, traces, spend alerts, error alerts, SLO dashboards, rollback and incident runbook.
- Security: rate limits, replay protection, abuse/safety policy, dependency scan and external penetration review.
- Release: canary cohort, evaluation thresholds, rollback rehearsal and owner sign-off.

Source completeness is not production activation. Production activation requires owner-controlled Cloudflare/provider accounts, DNS, credentials, billing and legal/privacy approvals.
