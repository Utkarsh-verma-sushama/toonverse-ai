# ToonVerse AI native release foundation

The production application identifier is `ai.toonverse.app` for Android, iOS and iPadOS. Changing it after either store's first public release creates a different app, so it must remain stable.

## Reproducible build flow

1. Use Node.js 22 or newer.
2. Install dependencies with `npm install`.
3. Run `npm run build:web` and `npm run verify:web`.
4. Add a platform once with `npx cap add android` or `npx cap add ios`.
5. Run `npm run native:sync` after every web change.

CI validates an Android debug APK, an unsigned release AAB, and an unsigned iOS Simulator build. Store builds stay deliberately unsigned until protected Google Play and Apple signing credentials are configured.

## Release gates

- Register the exact Android package name and Apple bundle ID `ai.toonverse.app`.
- Configure organization-owned signing keys through protected CI secrets; never commit certificates, profiles, keystores, passwords or API keys.
- Complete legal operator, privacy declarations, content rating, age rating, export compliance and review-contact metadata.
- Validate camera, file import/export, sharing, offline recovery, accessibility, orientation, low-memory behavior and interrupted-network recovery on real Android phones/tablets and iPhone/iPad hardware.
- Capture store screenshots only from the signed release candidate.
- Use staged rollout and halt automatically on crash, ANR, startup, privacy, payment or data-loss regressions.
- Mark Checkpoint 44 locked only after the public website and both store listings are live and independently reachable.
