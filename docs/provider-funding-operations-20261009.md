# Provider funding and operations controls

Observed: 2026-10-09

## Zero-owner-spend boundary

The provider funding policy is fail-closed:

- billing account remains disabled;
- owner spend cap is exactly 0 micro-USD;
- auto-top-up is disabled;
- paid requests are disabled;
- only the provider free-tier funding source is accepted.

A request that tries to enable billing, auto-top-up, paid requests, a non-zero cap, owner spend, or an unapproved funding source is rejected before dispatch. This policy does not store credentials or change the provider dashboard.

## Operations safety contract

The operations policy requires:

- a verified kill-switch before any activation;
- declared thresholds: error rate 5%, one open reconciliation item, 30-second latency, and 0 micro-USD spend;
- backup/restore evidence;
- version-pinned rollback evidence;
- automatic retries disabled;
- prompt/answer logging disabled;
- public endpoint disabled.

The local fixture drill verifies the shape of these controls. It is supporting evidence only: live production alert delivery, backup restoration, and rollback execution still need a fresh operator-observed run before activation can become eligible.

## Current decision

SAFE_OFF_PENDING remains the only permitted state. Generation, background AI, public endpoints, billing, and auto-top-up are not enabled. The evidence file intentionally does not authorize activation and stores no secrets or user content.
