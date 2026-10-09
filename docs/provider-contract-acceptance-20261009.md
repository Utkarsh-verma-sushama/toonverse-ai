# Uvenaro — Provider Contract Acceptance Audit

Date: 9 October 2026 (IST)

Status: **SAFE-OFF / ACCEPTANCE PENDING**

The acceptance evaluator is implemented in `backend/provider-acceptance.mjs` and
its tests run in the mandatory billing suite. It is deliberately separate from the
future-proof provider profile registry: profiles describe what a provider can do;
this audit decides whether that provider is acceptable for Uvenaro activation.

## Gate matrix

| Gate | Current status | Required evidence |
| --- | --- | --- |
| Project and tier | Supporting evidence only | Dated authenticated project binding and tier observation |
| Model and capability | Pending | Audited model profile, endpoint methods and capability limits |
| Pricing and zero-owner spend | Pending | Dated price snapshot, funding source and zero-owner-spend boundary |
| Privacy, retention, region and age | Pending | Reviewed policy evidence and enforcement decision |
| Preflight and usage accounting | Pending | Nonbillable count, headroom, thinking/output accounting |
| Reconciliation and retry policy | Pending | Lost-response handling, no automatic duplicate retry and receipt identity |
| Operations and rollback | Pending | Alerts, backup/restore and rollback drill evidence |

The current Google AI Studio Free-tier/no-billing observation supports the first gate
but does not complete the remaining gates or authorize generation.

## Fail-closed state machine

- `SAFE_OFF_PENDING`: one or more acceptance gates are incomplete; generation is off.
- `READY_FOR_AUTHORIZED_ACTIVATION`: every evidence gate passes, but explicit
  activation authorization is still absent.
- `ACTIVATION_AUTHORIZED`: every gate passes and an explicit authorization record
  exists. This state is evaluated, not automatically deployed.
- `REJECTED`: generation or activation is requested while evidence or explicit
  authorization is missing.

No provider call, billing change, public endpoint or background job is created by
this audit. Unknown fields, malformed dates and missing contract profiles fail closed.
