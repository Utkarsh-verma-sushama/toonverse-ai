# Read-only isolated staging re-audit

The exact-main CI attestation now feeds a read-only staging re-audit plan. The plan checks inventory, schema fingerprints, private binding scope, safe-off runtime state and rollback readiness in that order.

The plan explicitly disallows remote writes, provider calls, activation and owner spend. It is an eligibility plan only; it does not execute the re-audit or modify Cloudflare resources.
