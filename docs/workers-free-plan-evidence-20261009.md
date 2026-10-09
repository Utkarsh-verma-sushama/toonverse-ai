# Workers Free-plan evidence gate

Date: 2026-10-09

The Cloudflare subscription API currently returns an incomplete subscription inventory, so an empty API response is not treated as proof of the Workers Free plan. This step adds a bounded owner-dashboard evidence gate for the independent plan check.

The gate requires an account-bound dashboard observation, a Workers/Cloudflare Free label, a zero monthly price, billing disabled, a SHA-256 evidence digest and a capture age of no more than six hours. Raw screenshots, secrets, prompts and answers are never stored by the gate.

This evidence only verifies the plan observation. It never authorizes provisioning, paid requests, provider generation, billing changes or production activation. The zero-owner-spend boundary remains active.
