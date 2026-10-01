# Account security and release audit — 1 October 2026

## Starting evidence

The remote main branch and recovered checkout both pointed to
`92706cc803fba2505b7f55ba568e69b81692da32`. GitHub API evidence on 1 October:

| Workflow | Run | Result |
|---|---|---|
| Security policy gate | [176](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/36825736711) | Success |
| Cloud runtime validation | [395](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/36825736622) | Success |
| Native build validation | [424](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/36825736640) | Success |
| Deploy account staging | [21](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/36826078398) | Success |

All four runs identify the same SHA. The owner's manual acceptance is recorded
separately: account creation, email verification, repeat login, reload/reopen
persistence, password reset, old-password rejection, current logout, other-device
logout retaining the caller and all-device logout. Do not repeat those manual
tests without a specific regression. Phone/SMS OTP is not implemented or tested.

The assistant's subsequent read-only staging transport check passed with
`accountReady:true`, exact-origin protection and creative endpoints unavailable.
It did not sign in with the owner's credentials or send any real email.

## Defects corrected

1. A delayed protected response could survive a logout/account switch. A delayed
   old-account 401 could clear the newer session, and a delayed export could
   return private records after logout. Protected requests now bind to the auth
   generation before acquiring access and after reading the response. Stale
   responses are discarded without clearing the new account. Both failure paths
   were reproduced in regression tests before the fix.
2. Logout hid the dashboard but left private text, form values and session
   controls in its DOM. A browser regression reproduced the retained data. These
   fields are now cleared on logout/sign-in transitions; the dashboard becomes
   visible only after the current account's data is ready.
3. Selected-device and other-device logout required recent authentication at the
   backend but did not open the existing reauthentication dialog in the UI. Both
   now use that dialog and retry only after verification. Browser tests cover
   expiration of the five-minute recent-login window.
4. Manual staging deployment did not require Native/Cloud/Security success for
   its commit. A separate job now verifies all three required workflow files
   against the selected SHA and current main before the staging environment is
   used, with another check immediately before remote changes. The latest run
   must succeed; an earlier success cannot conceal a failed/in-progress rerun.
   Missing, malformed, truncated, fork/PR, skipped or unavailable evidence fails
   closed. The job has only contents/actions read permissions.

## Validation and limits

- `npm run verify:all`: 371 behavioral tests passed, none skipped, plus web bundle
  and core/chat checks. This includes 19 release-gate tests.
- Normal and generated-staging Chromium account suites: 13 tests each passed.
- Firebase Auth emulator: all 5 tests passed, including single-use verification
  and reset links and rejection of the old password.
- Workers/D1 tests now reject old access and refresh credentials after all three
  logout modes, preserve the caller for other-device logout, preserve unrelated
  owners, isolate session lists/revocation/export, and prevent an in-flight refresh
  from resurrecting a revoked session. Provider traffic is intercepted locally.
- Staging Worker build/dry-run passed. Production dependency audit: zero findings.
- Firestore/Storage rules and Android/iOS builds remain required CI gates on this
  revision. Local rules execution requires Java 21; this workspace has Java 17.
  A prior successful main CI run is not evidence for a changed revision.

No billing plan, Firebase/Cloudflare paid SKU, provider key, production activation
flag, database schema or real user password was changed. Staging forces chat,
agent execution, model routing and new TOTP enrollment off. Its scheduled job is
bounded session housekeeping, not AI processing. Production frontend chat,
cloud, agent, authentication and payment flags remain off. This source audit does
not independently inspect the current provider billing dashboards.

## Release and next work

Before merging, verify the three required CI workflows for this PR's actual head.
After merging, verify them again on the merge SHA. Deploy this reviewed revision
through the existing manual staging workflow with authentication enabled for the
existing invited pilot only. Check its live transport and deployed asset revision.
Run 21 remains the live baseline until that deployment succeeds.

The remote main branch was reported unprotected by GitHub at audit start. The
workflow gate protects this deployment path; it is not repository-wide branch
protection. No administrative repository setting was changed.

Then continue the V1 chatbot gateway/provider boundary without enabling paid or
background AI. Still-open later gates include physical native/iOS transport,
additional providers/passkeys/SMS OTP, MFA enrollment/recovery, actual alert
delivery, completed erasure and production/launch validation. They are not
silently included in the staging manual-account pass.

References for the release gate:
- https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2026-03-10
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
