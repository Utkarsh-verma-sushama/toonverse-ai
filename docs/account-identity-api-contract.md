# ToonVerse AI Account & Identity API Contract

Version: 1.0  
Status: security-first backend contract  
Frontend consumer: `assets/js/auth.js`

## Security invariants

- Use Authorization Code + PKCE for browser and native OAuth/OIDC flows.
- Never expose provider client secrets, signing keys, refresh tokens, or service credentials to frontend code.
- Keep access tokens short-lived and in memory only.
- Store refresh sessions in rotated `HttpOnly; Secure; SameSite=Lax` cookies, with CSRF protection.
- Hash passwords with Argon2id using parameters reviewed against current OWASP guidance.
- Encrypt sensitive identity data at rest and use TLS in transit.
- Rate-limit by account, device, network risk, and endpoint; do not rely on IP alone.
- Return generic authentication errors to prevent account enumeration.
- Require recent authentication for password, email, MFA, recovery, linking, export, and deletion changes.
- Log security events in append-only audit storage without passwords, tokens, OTPs, biometric data, or creative content.
- Apply least-privilege scopes and explicit consent independently to sign-in and connected publishing services.

## Identity providers

The provider adapter registry supports:

- Google
- Apple
- Microsoft
- Facebook
- LinkedIn
- X / Twitter
- GitHub
- Email and password
- Email or phone OTP
- Passkeys (WebAuthn)

Adding a provider must not change the internal ToonVerse user ID. Provider subject identifiers are stored as account links, not used as the primary project owner ID.

## Core endpoints

### Session

- `POST /v1/auth/session` — restore a session from the secure refresh cookie.
- `POST /v1/auth/refresh` — rotate refresh session and return a short-lived access token.
- `POST /v1/auth/sign-out` — revoke current session; accepts `{ "allDevices": boolean }`.
- `GET /v1/auth/sessions` — list verified active sessions.
- `DELETE /v1/auth/sessions/{sessionId}` — revoke a selected session.

Successful session responses:

```json
{
  "accessToken": "short-lived-token",
  "expiresAt": 0,
  "user": {
    "id": "stable-user-id",
    "name": "Display name",
    "email": "verified@example.com",
    "avatar": "https://approved-image-host/avatar",
    "emailVerified": true,
    "mfaEnabled": true
  }
}
```

### Email account

- `POST /v1/auth/register`
- `POST /v1/auth/sign-in`
- `POST /v1/auth/email/verify/request`
- `POST /v1/auth/email/verify/confirm`
- `POST /v1/auth/password/reset/request`
- `POST /v1/auth/password/reset/confirm`
- `POST /v1/auth/password/change`

Registration must verify normalized email ownership and check account-link candidates before creating a second user.

### OTP

- `POST /v1/auth/otp/request`
- `POST /v1/auth/otp/verify`

OTP requirements:

- Short expiry, single use, server-side hashing, attempt limit, resend cooldown, delivery throttling.
- Bind challenge to purpose, destination, device, and risk context.
- Never return the code in an API response or application log.
- Require stronger verification for risky recovery or account changes.

### OAuth / OIDC

- `POST /v1/auth/oauth/{provider}/start`
- `GET /v1/auth/oauth/{provider}/callback`
- `POST /v1/auth/links/{provider}`
- `DELETE /v1/auth/links/{provider}`

The start endpoint returns an allowlisted authorization URL after generating server-bound state, nonce, and PKCE values. Callback URLs must be exact allowlisted URLs. Validate issuer, audience, signature, nonce, state, code verifier, token timestamps, and provider subject. Do not trust profile email unless the provider marks it verified.

Account linking rules:

1. A provider subject can belong to only one ToonVerse account.
2. Matching email alone never silently merges accounts.
3. Linking requires an authenticated session plus recent re-verification.
4. Unlinking cannot remove the final usable sign-in method.
5. Conflicts use a deliberate recovery flow with security notification.
6. Every link/unlink operation revokes risky sessions and writes an audit event.

### Passkeys

- `POST /v1/auth/passkeys/register/options`
- `POST /v1/auth/passkeys/register/verify`
- `POST /v1/auth/passkeys/authenticate/options`
- `POST /v1/auth/passkeys/authenticate/verify`
- `GET /v1/auth/passkeys`
- `DELETE /v1/auth/passkeys/{credentialId}`

Use discoverable credentials where supported. Validate RP ID, origin, challenge, flags, signature counter behavior, and user verification. Never store biometric information; the authenticator retains it.

### MFA and recovery

- `POST /v1/auth/mfa/totp/enroll`
- `POST /v1/auth/mfa/totp/confirm`
- `POST /v1/auth/mfa/challenge`
- `POST /v1/auth/mfa/recovery-codes/rotate`
- `DELETE /v1/auth/mfa/{methodId}`
- `POST /v1/auth/recovery/start`
- `POST /v1/auth/recovery/verify`
- `POST /v1/auth/recovery/complete`

Recovery codes are high entropy, shown once, stored hashed, individually revocable, and regenerated after use on user request. Removing MFA requires recent strong authentication. Recovery changes trigger out-of-band alerts and a cooling period for high-risk actions.

## Device and risk security

Each session record includes opaque session ID, device ID, platform label, approximate region, created time, last active time, verification state, and current-session flag.

Risk signals may request step-up verification but must not become the only access path. Account access must remain possible through accessible recovery methods. Never use face, voice, fingerprint, precise location, contacts, or media without explicit purpose-bound consent.

Controls:

- New-device verification
- Active-session list
- Revoke selected session
- Logout all other devices
- Impossible-travel and token-reuse detection
- Credential-stuffing and bot defense
- Security alerts for password, email, MFA, provider-link, passkey, and recovery changes
- Signed device notifications where supported
- Session rotation after privilege changes
- Device name editing without trusting it as an authenticator

## Privacy and lifecycle

- Data minimization and purpose limitation
- Consent records for optional data
- Account data export
- Account deletion with confirmation and documented retention exceptions
- Provider disconnection and token revocation
- Child-safety and regional age handling
- Locale, timezone, and accessibility preferences
- Separate consent for analytics, personalization, marketing, and connected publishing

## Connected platforms

Publishing/import integrations are separate from sign-in. Examples include Instagram, Facebook Pages, X, Pinterest, YouTube, TikTok, Google Drive, OneDrive, Dropbox, and supported device file providers.

Each connection must have:

- Its own least-privilege scopes and consent screen
- Expiry and reauthorization status
- Disconnect and delete-token controls
- Clear destination/account selection before publishing
- Retry-safe idempotency keys
- Per-platform rate-limit handling
- Content policy and user-confirmation checks
- No automatic cross-posting unless explicitly enabled

## Reliability contract

- Idempotency keys for registration, OTP delivery, linking, recovery completion, and revocation.
- Structured stable error codes with localized frontend messages.
- Request correlation IDs without sensitive data.
- Transactional account linking and session revocation.
- Retry only safe requests with bounded exponential backoff and jitter.
- Degraded local editing remains available during account-service outages.
- Sync resumes only after authentication is restored and conflicts are resolved safely.

## Required verification before production activation

- Unit, integration, contract, accessibility, abuse, and end-to-end tests
- OAuth redirect and account-linking attack tests
- CSRF, XSS, session fixation, token replay, enumeration, rate-limit, and recovery abuse tests
- Android, iOS/iPadOS, Windows, macOS, Linux, major browsers, WebViews, keyboard, touch, screen reader, and low-memory testing
- Provider approval, verified domains, privacy policy, terms, deletion URL, support contacts, and incident-response runbook
- Secret rotation, backup restoration, monitoring, alerting, and rollback drills

Until these requirements and backend configuration are complete, the frontend must show the account service as unavailable and must not simulate successful authentication.
