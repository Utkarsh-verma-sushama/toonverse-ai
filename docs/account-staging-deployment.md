# Account staging deployment

Date: 2026-09-24. Status: source, deployment preflight, bundle and local tests completed; **not deployed**. Continues the [account backend checkpoint](account-backend-checkpoint.md).

## Current access blocker

The repository identifies the existing Firebase project `toonverse-ai` and its public web configuration. The account API endpoint, actual staging D1 database and deployment credentials were not configured in this workspace. No authenticated Firebase console session was available. The Cloudflare dashboard repeatedly showed its security verification page in the assistant browser, so dashboard automation stopped after one reload. No provider account, database, domain, DNS record, template or production feature flag was changed.

The deployment command was executed only to validate its preflight: it stopped before remote operations and reported missing configuration. The Cloudflare bundle dry run passed. Local test success is not a remote deployment, email-delivery test or physical-device sign-in result.

## Implemented deployment path

- `backend/staging-worker.mjs` serves account UI and `/api/v1/auth/*` / `/api/v1/account/*` on the same HTTPS origin. It preserves cookie, Origin and device headers while removing `/api` before the existing Worker.
- Only a configured staging environment and exact non-production origin are accepted. AI/agent/routing endpoints are unavailable, and new TOTP enrollment is forced off for this first account pilot.
- Up to 20 explicit test email addresses are allowed. Signup/login, protected sessions, refresh, email change and checked action-code destinations enforce the list. Reset requests for other addresses return the same generic response without sending email. These are application API restrictions, not Firebase-wide restrictions against clients using Firebase directly.
- The public asset directory is built from seven reviewed files. It contains no backend, SQL, deployment configuration or secrets. The staging page is labeled for invited testers, sends no referrer, denies framing, uses same-origin scripts/connections and is marked noindex. Noindex is not access control; the shell remains publicly readable. Account data still requires authentication.
- Service-worker installation and API caching are disabled in this test shell. Existing production frontend configuration remains unchanged.
- Generated tracked migrations contain `0000_baseline.sql`, then the original 0001/0002 migrations. Before remote migrations, the script verifies both the configured UUID and exact database name `uvenaro-account-staging`. The production database is not a permitted deployment target.
- One pinned Wrangler release builds/uploads the Worker and assets. Session encryption and Firebase bindings are uploaded through a mode-0600 temporary secrets file outside public assets, which is removed in `finally`. Keys are never printed, put into browser assets or committed. The session key must be retained across deployments; replacing it invalidates existing sessions.
- `/api/v1/health` distinguishes local configuration/schema readiness from actual provider validation (`providerChecked:false`). `check:account-staging` checks routes, CSP-related headers and hostile-origin rejection without creating users or sending email.

## Owner-controlled setup

The following settings are required before the reviewed deployment can run. Never send secret values in chat.

1. Use the owner's Cloudflare account. Create a **new** D1 database named `uvenaro-account-staging`; do not reuse `uvenaro-core` or another existing product database. Record its UUID and the Cloudflare account ID.
2. Establish Cloudflare access for this repository through an account-scoped deployment token with the required Worker and D1 permissions. The owner performs any account creation, Terms acceptance or new security-sensitive grant. Configure the token as a protected CI secret.
3. Set the exact default Worker address `https://uvenaro-account-staging.<your-subdomain>.workers.dev`; no production DNS change or custom domain is needed for this pilot.
4. Select a dedicated test mailbox (or up to 20) whose owner consents to test emails and password/account changes. Do not use the operator's Google/Firebase administrator identity as a disposable application test account.
5. Generate and retain a cryptographically random 32-byte base64url `ACCOUNT_SESSION_KEY` using a trusted local/password-manager facility. Store it as a protected CI secret; do not rotate it every build.
6. In the existing Firebase project, verify email/password sign-in settings and add the exact staging hostname to authorized domains. The wrapper provides a fixed server-controlled `continueUrl` back to `/account.html`. Keep Firebase's existing hosted email action handler and global templates for this initial pilot; do not overwrite working production templates just for staging. Actual email delivery, quota/settings and action links still require live validation.

The prepared manual GitHub Actions workflow uses environment `uvenaro-account-staging` with these values:

| Name | Storage | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Environment secret | Correct Cloudflare account |
| `CLOUDFLARE_API_TOKEN` | Environment secret | Restricted Worker/D1 deployment access |
| `UVENARO_STAGING_DATABASE_ID` | Environment secret | New staging D1 UUID |
| `UVENARO_STAGING_ORIGIN` | Environment variable | Exact staging HTTPS origin |
| `UVENARO_STAGING_ALLOWED_EMAILS` | Environment secret | Comma-separated invited test addresses |
| `ACCOUNT_SESSION_KEY` | Environment secret | Persistent session encryption key |

The existing public Firebase project/key is read from the reviewed repository configuration; it does not grant administration. Secret material is never read from the public frontend. Do not add a Firebase Admin credential for these email/password API flows.

## Deployment sequence

After the PR stack has been reviewed/integrated and the manual workflow is available on the default branch:

1. Run **Deploy account staging (manual)** with `enable_auth=false`. The workflow builds/tests, verifies the database identity, applies tracked migrations and deploys the disabled account pilot.
2. Check the generated staging URL and Firebase settings/domain. The health response should identify the staging service and show `accountReady:false`.
3. Run the same workflow with `enable_auth=true` once the test mailbox and provider configuration are ready. Run the mobile validation below. This enables only invited email account access, never paid AI, cloud sync or payments.
4. To stop the pilot, rerun with `enable_auth=false`. This disables account routes; it does not erase data or automatically revoke stored sessions. If credentials were compromised, revoke sessions and rotate the key under the incident procedure before re-enabling.

CLI equivalents (in an authenticated, configured environment):

```sh
npm run build:account-staging
npm run verify:account-staging-build
npm run deploy:account-staging
npm run check:account-staging
```

The manual deployment workflow has no push/PR trigger. Repository checks do not deploy anything. `wrangler deploy --dry-run` validates/bundles only. Database or provider creation, remote deployment and actual mail were not performed in the current work.

## Mobile acceptance sequence

On the resulting staging address, using the invited test mailbox:

1. Create account, verify the mailbox, return to account and confirm verified status.
2. Sign out, sign in, reload and close/reopen the browser; confirm session behavior.
3. Request password reset; confirm real email, expiry/single use, new password and old-password rejection.
4. Open another browser/device; list/revoke the other session and check its access stops.
5. Change the display name; export records; confirm no token/password material appears.
6. Test offline/lost network during login/logout/reset and verify that failure is visible.
7. Test selected current Android browser, then iPhone/iPad Safari and native WebView transport separately. Native authentication remains disabled until its secure transport is implemented and validated.

Do not describe these as completed until results come from the real deployed service and actual mailbox/devices. Full Google/Apple/passkey support, MFA enrollment/recovery, notification delivery and completed account erasure remain separate open account work.

## Verification evidence

- 17 new staging behavioral/build/preflight tests: origin isolation, disabled paid routes, readiness, same-origin login/rotation/logout, invite scope, OOB checks, generated asset boundary, empty tracked schema and database identity guard.
- 10 Chromium browser tests additionally run against the actual staging wrapper/generated frontend and local HTTPS transport, with signed Firebase fixtures. New TOTP enrollment is asserted unavailable; existing MFA sign-in is exercised with fixtures.
- Existing account, identity, billing, D1, Firebase emulator and browser tests remain CI gates. Firebase Auth emulator coverage now also verifies non-consuming email action inspection through `accounts:resetPassword` before applying the code.
- Pinned Wrangler `4.137.0` dry-run bundles the real staging entry point and assets. Remote deployment credential/configuration preflight fails closed as expected.

## References

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://firebase.google.com/docs/auth/web/passing-state-in-email-actions
- https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/resetPassword
