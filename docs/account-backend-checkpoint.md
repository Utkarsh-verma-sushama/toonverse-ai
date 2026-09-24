# Account backend — 24 September 2026

Status: implemented and locally verified email/password account backend; production activation remains disabled. This change builds on the identity-security and atomic-billing changes. It does not complete every future provider or the product launch.

## Delivered

- Firebase email/password registration and sign-in; stable verified Firebase UID owns every account and server record. No client-selected UID, role, subscription, credits or verified-email flag is trusted.
- Email verification, verified email change, password reset and password change. New passwords require 12–128 characters without normalization. Firebase manages password hashing; Uvenaro never stores passwords.
- Opaque five-minute application access tokens in browser memory, hashed rotating refresh tokens in D1 and a host-only `HttpOnly; Secure; SameSite=Lax` cookie. Firebase credentials stay AES-GCM encrypted in D1 with session/owner binding.
- Thirty-day absolute and seven-day idle sessions, bounded to twenty active sessions. Current-device, selected-device, other-device and all-device revocation. Every protected request checks the managed session, Firebase signature/current account status and revocation; a raw Firebase JWT cannot bypass managed-session revocation.
- Exact trusted HTTPS origins, custom CSRF/device headers, duplicate-cookie rejection, account/device/network throttling with keyed identifiers, single-use MFA challenges, bounded upstream bodies/timeouts and non-sensitive security events.
- Refresh rotation has one atomic claimant. Concurrent retries return `409 SESSION_REFRESH_BUSY`; old-cookie replay after ten seconds revokes the session family. Interrupted refresh locks expire after two minutes. Ambiguous refresh failures revoke the session and require sign-in.
- Recent authentication (five minutes) for password/email/MFA/export/deletion/all-device logout. Password changes/reset revoke managed sessions before applying the provider change. Failure to persist revocation prevents the provider change; a subsequent provider rejection can therefore require signing in again with the existing password.
- Firebase Identity Platform TOTP sign-in, enrollment, reauthentication and removal. Enrollment is separately disabled until the actual provider configuration and recovery procedure are validated. No custom OTP cryptography or simulated delivery.
- Profile name/locale/timezone, active sessions, security history, connected sign-in methods, owner-scoped paginated account/server export, and a cancellable deletion request. Export includes sessions, security, billing account/limits/ledger/reservations, agents/steps/approvals, routes, audit and deletion records; it excludes credential material. Local creative files are exported separately from My Library. Browser export is capped at 20 MiB/200 pages and reports an error beyond that limit.
- Accessible native dialogs for recovery, reauthentication and MFA, real download behavior, immediate local logout and cross-tab notification. Failed server logout remains visible and blocks automatic restoration on the device. Account form autosave is disabled and legacy route-recovery drafts are removed. Email action codes are removed from the URL; the page sends no referrer and uses external scripts only.

## Important boundaries

| Capability | Current status |
| --- | --- |
| Email/password and account/session controls | Source implemented; staging and production configuration required |
| Authenticator TOTP | Source and mocked protocol tests implemented; Identity Platform configuration and real authenticator validation required |
| Google/Apple/Microsoft/Facebook/LinkedIn/X/GitHub, linking | Planned; adapters absent; capabilities and controls unavailable |
| Passkeys, phone/email OTP, MFA recovery codes | Planned; not implemented or advertised |
| Account deletion | Request/cancellation and creative-access restriction implemented; no purge worker, retention decision or completed erasure |
| Security email notifications, anomaly detection | Audit history exists; alert delivery and risk operations remain pending |
| Firebase direct-client/cloud sync | Disabled; application tokens are not Firebase client tokens; authenticated private sync requires its own backend transport |
| Native sign-in | Native packages compile; actual Android/iOS cookie/origin transport and physical-device flows remain release gates |

A deletion request is explicitly `pending_review`, with a seven-day earliest eligibility timestamp; it never states that data has been deleted. The current device can inspect/export/cancel the request. Other sessions are revoked. Do not use this workflow as a promise of automatic erasure or a completed store deletion requirement.

## Files and API

`backend/account-api.mjs` routes the account API; `account-sessions.mjs` owns session lifecycle; `account-mfa.mjs` owns provider challenges; `account-common.mjs` holds validation/crypto/CSRF/rate limits; `firebase-accounts.mjs` is the bounded provider adapter. The existing cryptographic verifier remains in `firebase-auth.mjs`.

See [OpenAPI account contract](../backend/openapi-account.yaml) and [identity capability contract](account-identity-api-contract.md). All account responses use `Cache-Control: no-store`. Standard stable errors include `SESSION_EXPIRED`, `RECENT_AUTH_REQUIRED`, `MFA_REQUIRED`, `TOO_MANY_ATTEMPTS` and unavailable-service codes. Recovery request responses do not disclose whether an email exists. Registration errors do not disclose an existing provider or offer automatic account merging.

For every account request send `X-Uvenaro-CSRF: 1` and a persistent random `X-Uvenaro-Device` identifier. Cookie mutations require an exact allowlisted `Origin`. Browsers may omit Origin on GET; only `Sec-Fetch-Site: same-origin` permits deriving the request origin for such GET requests. Protected routes additionally require `Authorization: Bearer uv1.…`. `POST /v1/auth/session` and `/refresh` use the cookie. Access tokens and provider secrets must never go into localStorage, URLs or logs.

## Staging and activation procedure

1. Keep frontend `features.authentication`, `ACCOUNT_AUTH_ENABLED`, `ACCOUNT_TOTP_ENABLED` and AI/cloud/payment execution disabled while preparing infrastructure. Preserve and back up the existing database.
2. Apply `backend/schema.sql` only for a new database, then tracked D1 migrations `0001_atomic_chat_billing.sql` and `0002_account_sessions.sql` in order. Existing baseline databases apply only unapplied migrations. No migration funds accounts.
3. Configure the existing Firebase project (`toonverse-ai`), its matching restricted Web API key, enabled email/password provider, password policy, email enumeration protection, quotas and verified domains. No Firebase Admin service account is required for these email flows. Restrict the API key for both Identity Toolkit and Secure Token APIs as needed for lookup/sign-in/refresh.
4. Generate a 32-byte cryptographically random base64url `ACCOUNT_SESSION_KEY` and store it as a Worker secret. Never commit it. Protect backups containing encrypted sessions. Key replacement invalidates existing ciphertext; revoke sessions and plan a controlled sign-in reset during rotation. Multi-key transparent rotation is not implemented.
5. Serve the web and API on the same HTTPS site, preferably one origin with an `/api` reverse proxy that strips `/api` before the Worker. Set `apiBaseUrl` and exact `ALLOWED_ORIGINS`; preserve browser Origin and secure cookies. Do not use wildcard origins or cross-site third-party-cookie assumptions. Native localhost/custom-scheme origins are not yet supported by this cookie protocol.
6. Configure Firebase email templates/action handler to the account page, verify the custom domain and test actual verification, verified email change, password reset, expired/reused links and support delivery. Auth emulator success does not prove real email delivery.
7. In staging only, enable account service and frontend authentication. Exercise create/sign-in/reload/logout, disabled/deleted identity, revocation, account switching, multiple tabs/devices, outage/lost responses, reauthentication, export and deletion request/cancel. Registration creates a Firebase identity before the application session transaction; if D1 fails, subsequent sign-in recovers that identity without inventing a second UID.
8. Enable TOTP only after Identity Platform support, real enrollment/sign-in/removal, lockout/recovery support and device validation pass. Keep other method capabilities false until their actual implementations and tests exist.
9. Validate retention/deletion processing, monitoring, support, rollback, backup restore, key handling and physical Android/iPhone/iPad sign-in before production activation. No production account, email, MFA, Worker, database or public feature flag was changed by this checkpoint.

## Verification

Local verification at this checkpoint:

- `npm run verify:all`: 205 behavioral tests (57 identity/API, 93 billing/chat/client/local-D1 and 55 account/backend/client), plus the 22-route web bundle and core checks.
- `npm run verify:account-ui`: 10 real Chromium tests against a local HTTPS server invoking the actual Worker with signed identity fixtures. Browser web security remains enabled. Tests cover session cookies/restoration/logout, signup, MFA/reauthentication, recovery, export/deletion and absence of account autosave. Desktop/mobile screenshots were inspected.
- `npm run verify:account-emulator`: 5 Firebase Auth emulator tests through the production REST adapter (registration/sign-in, invalid password, refresh, verification and reset single use). Emulator unsigned tokens are not accepted by the production signature verifier.
- Existing `npm run verify:rules`: 43 Firestore/Storage emulator regressions remain an independent CI gate.
- `npm audit --omit=dev --audit-level=high`: production dependency gate.

These checks exercise local SQLite, actual Cloudflare local D1/workerd, Firebase emulators and browser flows. Provider MFA responses in Worker/browser tests are fixtures; live Firebase TOTP, delivery, production D1 and physical-device validation are not claimed. Native CI builds provide packaging evidence only.

## Staging preparation update

The [account staging deployment](account-staging-deployment.md) now provides the same-origin test host, invite restrictions, isolated migration/deployment path and browser/preflight tests. Actual deployment is blocked by missing Cloudflare configuration/access and Firebase console sign-in. No live activation is claimed.

## Next engineering work

Finish and stage account release operations above, then implement the audited V1 model gateway and reconciliation adapter. OAuth/linking/passkeys/recovery codes, security alert delivery, complete deletion processing, native session transport and private cloud sync remain explicit account backlog items.
