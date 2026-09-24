# UVENARO

UVENARO is a cross-platform AI creative and productivity ecosystem in active pre-launch development.

## Current verified foundation

- Responsive web/PWA experience published at `https://uvenaro.com`
- Advanced browser image editor with recovery, history, export and print foundations
- Creative studios for layouts, wallpaper, coloring, memory, camera and multimodal workflows
- Local-first project library, autosave and crash recovery
- Firebase configuration and deny-by-default Firestore/Storage rules
- Provider-neutral AI, cloud-sync, agent and model-routing contracts
- Capacitor Android/iOS wrappers with automated unsigned build validation
- Privacy, Terms, support, QA, launch-control and store-listing foundations

## Honest release status

The repository is a verified foundation, not a finished production AI service. Expensive AI generation, production cloud sync, payments, signed native releases and store distribution remain disabled until their security, legal, billing, provider and physical-device gates pass.

## Verification

```bash
npm ci
npm run verify:all
npm audit --omit=dev --audit-level=high
```

## Release principle

No feature is described as active unless the corresponding production service, entitlement, safety controls and recovery path are verified. See `docs/checkpoint-status.md` and `docs/cloud-release-gates.md` for the authoritative gates.

## Account backend

Email/password and managed account sessions are implemented with default-off activation. See [account backend scope and verification](docs/account-backend-checkpoint.md) and [implemented API](backend/openapi-account.yaml). Additional providers, native cookie transport, completed erasure and production activation remain explicit gates.
