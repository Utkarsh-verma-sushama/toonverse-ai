# Backend security checkpoint — 24 September 2026

## Source and scope

Resumed from upstream `305108211511a02777983b26a97719de509c127d` and recovered the local identity patch `2b8d54b1a6d0fb726af3bca6f965c7a59a456fb1`. Work is on `codex/uvenaro-backend-security-20260924`. This record supersedes conversational statements that backend source was unavailable. The backend source is in `backend/`.

This checkpoint hardens identity, API ownership boundaries and Firebase client rules. It does not constitute production deployment or a completed product launch.

## Implemented

- All protected API routes require a signed Firebase ID token. Missing environment configuration and `AUTH_REQUIRED=false` cannot create a development identity. The only public route is the minimal health endpoint; CORS preflight remains unauthenticated.
- Strict RS256, key ID, issuer, audience, UID, numeric expiry/issue/authentication timestamps and single-project checks. Google signing keys have a bounded cache with one refresh for concurrent requests, bounded refresh frequency and no use of expired keys during outages.
- Firebase `accounts:lookup` checks current UID, disabled/deleted status and `validSince` against the token's original `auth_time` on every authenticated request. Tokens and account data are not logged. Identity dependency outages fail closed with HTTP 503.
- Caller UID comes only from verified identity. Reading, cancelling and approving an agent run uses that UID. Missing, expired, terminal or already-decided records cannot produce false success. Approval updates re-check owner, expiry and run status atomically.
- Agent execution and model routing have independent backend flags, disabled by default. Creating an agent requires database and queue bindings. This does not implement the queue consumer.
- JSON requests are limited to 64 KiB, including requests without a Content-Length. Async errors remain generic and allowed-origin responses consistently carry CORS headers.
- Firestore profiles/projects validate fields, types, size bounds, owner and server timestamps. Creation timestamps are immutable. Thumbnail paths must belong to the same user. Claims, evidence, audit, billing and unspecified collections are backend-only, including for client tokens with an admin claim.
- Storage enforces per-user access, a declared media MIME allowlist, nonempty files up to 100 MiB and constrained custom metadata. Active SVG/HTML, forged owner metadata and unsupported ordinary custom metadata are rejected. Firebase reserved download-token metadata is outside this rule boundary; bearer URLs are explicitly tested and documented below. Evidence and unrecognized paths are backend-only.

## Verification

Local result: **100 tests passed** (40 identity, 17 API/SQLite, 43 Firebase emulator tests), with no skipped tests. Public deployment has not been performed.

- `npm run verify:all`: web build, all 22 registered native routes, asset/core checks, disabled-chat check, plus 57 behavioral security tests.
- Identity tests use freshly generated RSA signatures and simulated Google responses; they do not contact a live identity account.
- API ownership tests use an actual in-memory SQLite database with the repository schema and a thin D1 interface adapter.
- `npm run verify:rules`: Firebase Firestore and Storage emulators, project `demo-uvenaro-security`; requires Java 21+. The tests cover positive owner flows and negative anonymous/cross-user/admin-claim flows, profile/project tampering, private collections and file validation.
- Production dependency audit: zero known vulnerabilities. The full dependency audit includes seven moderate findings in development tooling and zero high/critical findings at this checkpoint; they are not shipped in the public bundle.
- CI runs the security suite and rules emulator suite before this change can be accepted.

## Activation requirements and limitations

1. Deploying source is separate from configuring and deploying Firebase rules and the Worker. Rules changes are not active in the live Firebase project merely because they exist in GitHub.
2. Set `FIREBASE_PROJECT_ID` to the actual existing project and `FIREBASE_WEB_API_KEY` to a matching key restricted for Identity Toolkit from the backend. The existing project identifier remains `toonverse-ai`; changing branding does not rename Firebase resources.
3. No production sign-in or revocation test has been run against the owner's Firebase account. Stage valid login, refresh, logout/revocation, disabled user and account deletion before activation. Current frontend account routes still require backend implementation.
4. Direct Firebase client rules enforce user separation but do not independently fetch current Firebase Auth revocation state. Immediate revocation for direct Firebase clients requires server-maintained revocation metadata and rules checks, or moving those operations behind the verified API. Cloud sync remains disabled.
5. Firebase token download URLs grant bearer access. The emulator accepts reserved `firebaseStorageDownloadTokens` metadata outside the custom-metadata map, so the rules must not be claimed to prevent such links. An emulator regression records a successful unauthenticated fetch using an owner-created token URL. Use a backend-controlled private upload/download path and revoke existing token URLs before promising UID checks on every download. Storage checks declared MIME only. Byte-level validation, malware scanning, safe download responses, controlled sharing, aggregate storage quotas and handling existing download-token URLs remain required. Backend/Admin SDK writes bypass Firebase rules and need their own authorization.
6. Profile/project clients must use server timestamps and the documented fields. Migrate any existing documents with unsupported fields before deploying stricter rules.
7. Keep `CHAT_EXECUTION_ENABLED`, `AGENT_EXECUTION_ENABLED`, `MODEL_ROUTING_ENABLED` and frontend AI/cloud/payment activation flags off until their separate release gates pass.

## Remaining work, in execution order

| Priority | Work | Current evidence / completion gate |
|---|---|---|
| 1 | Atomic chat credit reservation and settlement | Source implementation now added in the next checkpoint: [Atomic Chat Billing](atomic-chat-billing.md). Activation still requires the audited gateway, real pricing, funded accounts and staging validation. |
| 2 | Actual sign-in and account backend | `assets/js/auth.js` calls account/session endpoints not implemented by the core Worker. Implement the Firebase-backed contract, recovery and session controls and test on staging. |
| 3 | V1 AI chatbot provider | Provider secret, verified provider pricing/privacy configuration, conversation handling, streaming/cancellation, safety and cost limits are pending. A separate prior local Gemini adapter commit `4fb013e` exists in the earlier checkout but is not verified or integrated here. |
| 4 | Cloud project/file service | Implement the project sync API, private media lifecycle, retention/export/deletion and backup/restore; verify isolation with real staging bindings. |
| 5 | Advanced AI/agent execution | Queue consumer, tool permissions, spending/step limits and all advertised image/video/voice features need actual provider implementations and end-to-end tests. |
| 6 | Native/release gates | Signed builds, real Android/iPhone/iPad testing, company/store account requirements, accurate disclosures and staged launch. No soft or public launch has occurred. |

## Reference contracts

- https://firebase.google.com/docs/auth/admin/verify-id-tokens
- https://firebase.google.com/docs/auth/admin/manage-sessions
- https://firebase.google.com/docs/reference/rest/auth#get_user_data
- https://firebase.google.com/docs/firestore/security/rules-fields
- https://firebase.google.com/docs/storage/security/rules-conditions
