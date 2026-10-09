# Uvenaro — Gemini private binding and readiness checkpoint

Date: 9 October 2026 (IST)

## Accepted safe-off state

- Repository: `Utkarsh-verma-sushama/toonverse-ai`
- Private Worker: `uvenaro-bounded-provider-adapter-staging`
- GitHub environment: `uvenaro-account-staging`
- Secret binding: `GEMINI_API_KEY` is present as a Cloudflare `secret_text` binding.
- `GEMINI_GENERATION_ENABLED=false`.
- `GEMINI_EXECUTION_CONFIRMATION` is empty.
- Public workers.dev and preview endpoints are disabled.
- Worker observability is disabled.
- The key value is not stored in source, logs, artifacts or this document.

Evidence:

- [Private binding run](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/37889873118)
- [Read-only safe-off smoke run](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/37890366871)
- [Safe-off smoke workflow](../.github/workflows/gemini-safe-off-smoke.yml)

The smoke run read Worker metadata only. It made no Gemini/provider request, enabled no generation, changed no billing setting and exposed no endpoint.

## Owner-dashboard read-only evidence

The signed-in Google AI Studio dashboard was checked without copying or revealing the key:

- Project `Toonverse AI` / project ID `toonverse-ai` is present.
- The key label `Uvenaro Staging Gemini` is listed under that project.
- The project and key show **Free tier**.
- The Spend page states that no billing is currently set up for the project.
- The Usage page for the last 28 days shows no data available. Google notes that usage can take up to 15 minutes to update, so this is supporting evidence—not a permanent guarantee for future traffic.

## Readiness boundary

The private key binding and current owner-dashboard evidence are accepted as secure staging prerequisites; they are **not** provider activation evidence. The following remain intentionally unverified:

1. Exact model/endpoint support and reviewed input/output/thinking-token caps.
2. Current pricing, privacy, retention, region and age-policy acceptance.
3. Non-billable preflight/counting behavior and lost-response reconciliation against the live provider.
4. Funded production policy and explicit zero-owner-spend approval.

Generation, paid execution, background AI, automatic retries and public launch remain off.

## Security decision

A temporary workflow that embedded a raw vendor URL was rejected by the repository provider-configuration guard and removed. The guard was not weakened or bypassed. Any future provider-readiness implementation must use an already-reviewed integration boundary and preserve the safe-off defaults.
