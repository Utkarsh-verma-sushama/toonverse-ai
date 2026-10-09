# Workers Free-plan evidence gate

Date: 2026-10-09

The Cloudflare subscription API currently returns an incomplete subscription inventory, so an empty API response is not treated as proof of the Workers Free plan. This step adds a bounded owner-dashboard evidence gate for the independent plan check.

The gate requires an account-bound dashboard observation, a Workers/Cloudflare Free label, a zero monthly price, billing disabled, a SHA-256 evidence digest and a capture age of no more than six hours. Raw screenshots, secrets, prompts and answers are never stored by the gate.

A capture that passes every check except the six-hour freshness window is classified as historical evidence only. It is useful for audit continuity, but it does not close the current verification gate; future-dated captures are not historical evidence. A fresh owner-dashboard observation is required before any later stage could consider the plan currently verified.

This evidence only verifies the plan observation. It never authorizes provisioning, paid requests, provider generation, billing changes or production activation. The zero-owner-spend boundary remains active.

For dashboard layouts that separate account identity from plan details, the bundle gate accepts one bounded set of up to four owner-dashboard captures. It requires at least one account-identity capture bound to the expected account and one Workers-plan capture showing Free, $0/month and billing disabled. Each capture is individually time-checked and SHA-256 bound; a plan capture may omit a repeated account ID because the bundle's identity capture supplies that binding.

The bundle is an evidence reconciliation boundary only. It does not store the captures and it cannot authorize provisioning, provider calls, billing changes or activation.
