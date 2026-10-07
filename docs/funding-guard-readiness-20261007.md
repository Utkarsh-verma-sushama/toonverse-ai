# Uvenaro — Funding Guard and reconciliation final readiness

Date: 7 October 2026. Scope: account security, prepaid spending safeguards and
agent reconciliation engineering. Status: local verification passed; final lock
requires successful CI and Pages on the revision containing this report.
This is not a production activation or an all-ecosystem release certification.

## Verified baseline

Repository: `Utkarsh-verma-sushama/toonverse-ai` (legacy repository identifier).
Exact base main: `69f3dffb7d32e57e20d3af1ddede5a9888bf2b7a`.
GitHub Actions API evidence retrieved on 7 October 2026:

| Workflow | Run | Result | Evidence |
| --- | --- | --- | --- |
| Security policy gate | 299 | Success | [Run](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/37282297649) |
| Cloud runtime validation | 517 | Success | [Run](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/37282297471) |
| Native build validation | 546 | Success | [Run](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/37282297465) |
| Pages build and deployment | 546 | Success | [Run](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/37282296822) |

The old `01da3b2f` failure is superseded. Owner-reported staging account acceptance
is retained: signup, verification, persistent login, password reset/change and
current/other/all-device logout. It does not establish production/native readiness.

## Final audit improvement

The existing stale-cleanup regression checked SQL shape and unresolved lifecycle
states but did not execute expiry against a valid expired reservation. The added
test invokes the real `expireUndispatched` implementation and production triggers.
An isolated test-only SQLite clock delegates date parsing/modifiers to SQLite;
no reservation timestamps are edited and no triggers or spending limits are removed.

The regression proves that only an expired never-dispatched hold is released,
a fresh hold remains reserved, expired started/unknown holds remain reserved for
privileged reconciliation, available included/prepaid credits are unchanged,
reserved-credit accounting remains consistent across owners, one release ledger
entry is written, and a repeated sweep cannot duplicate that release.

## Local evidence on this change

| Check | Result |
| --- | --- |
| Node runtime | 24.19.0 |
| Locked dependency install, lifecycle scripts disabled | Passed |
| `npm run verify:all` | Passed: 457 tests (129 security, 189 billing, 79 accounts, 60 staging/release), plus web build/bundle/core checks |
| `npm run verify:account-ui` | Passed: 13 Chromium tests |
| `npm run verify:chat-ui` | Passed: 4 Chromium tests |
| `npm run verify:account-staging-ui` | Passed: 13 Chromium tests |
| Targeted agent reconciliation | Passed: 8 tests; included in billing above |
| Production dependency audit | Passed: zero vulnerabilities |
| Firestore/Storage and Auth emulators | Not rerun locally: installed Java is below required JDK 21; Cloud runtime CI provisions JDK 21 and must run both |

These 487 suite tests exercise local fixtures, browser flows and local Workers/D1;
they do not prove real paid provider behavior or physical-device compatibility.

## Exact phase-lock procedure

1. Select the exact main SHA containing this report and regression.
2. Verify the latest main push/dispatch run of each mandatory workflow is complete
   and successful on that same SHA; include both Android and iOS native jobs.
   Do not substitute baseline successes, pull-request runs or another revision.
3. Verify successful Pages deployment on that SHA and confirm main has not moved.
4. Record those run URLs and the SHA as the engineering phase-lock evidence.
   Failed, missing or running checks leave the phase unlocked.

No test failure was resolved by changing production safeguards. AI execution,
paid confirmations, provider dispatch/routing and payment activation were not enabled.
The staging housekeeping cron only releases never-dispatched expired holds;
it does not authorize background AI generation or provider calls.

## Remaining release gates and next engineering work

The next engineering dependency is the audited V1 metered chatbot gateway:
authoritative provider receipts, bounded dispatch, reconciliation integration and
end-to-end safety/cost verification in pre-production. Keep paid execution off.
Existing contracts are not evidence that every advertised AI tool is operational.

Production remains blocked by applicable live identity/attestation/replay checks,
audited provider pricing and gateway, funded entitlements/payment webhooks,
private cloud/media service, completed erasure and alert delivery, monitoring,
backup/restore and rollback drills, real Android/iOS session transport, signed
build/device tests and legal/store release gates. Track these using
[cloud release gates](cloud-release-gates.md),
[account boundaries](account-backend-checkpoint.md) and
[prelaunch security gate](PRELAUNCH_SECURITY_GATE.md).
