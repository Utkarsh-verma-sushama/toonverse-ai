# Expanded AI Capability Contract — Checkpoint 34

The editor exposes provider-neutral operations for AI Enhance, Auto Fix, Background Remove/Change, Object Remove, Upscale, Restore, Colorize, Cartoon, Portrait, Lighting, and Prompt Edit.

## Invariants
- Every operation is asynchronous, cancellable, authenticated where required, and idempotent.
- Originals are preserved. A completed output enters the editor as an undoable external edit.
- No artificial progress. Status comes from the generation job service.
- Provider/model details remain behind the capability router so models can change without rebuilding the editor.
- Missing or unhealthy services produce an honest unavailable state.
- Face, portrait, restoration and colorization require purpose-bound rights/consent confirmation.
- Deity/God face replacement, non-consensual intimate imagery, sexual exploitation, impersonation abuse, copyright abuse and prohibited transformations are blocked across upload, processing, generation, export, share and publish.
- Object/background edits require segmentation confidence, edge-quality checks and safe fallback.
- Upscale must preserve aspect ratio, avoid fabricated identity detail, report scale and model provenance.
- Restore/colorize must label synthetic reconstruction where context requires it and retain the original.
- Prompt Edit must constrain changes to the user's instruction and preserve non-target regions where supported.

## Job inputs
Operation, source media, optional mask/selection, prompt, strength, preserveOriginal, consent assertion, output constraints, locale, accessibility preferences and client idempotency key.

## Job outputs
Short-lived signed media URL, checksum, MIME type, dimensions, model/version, operation, safety/provenance metadata, warnings, confidence where meaningful, and expiration.

## Reliability and quality
Capability discovery, health routing, circuit breakers, bounded failover, resumable uploads, cancellation propagation, per-operation timeouts, memory limits, retry-safe semantics, partial-result handling, audit correlation and deletion/retention controls.

## Required testing
Unit, contract, integration, visual-regression, segmentation-edge, identity-preservation, safety, privacy, accessibility, cancellation, provider-outage, low-memory, slow-network and cross-device tests on Android, iOS/iPadOS, Windows, macOS, Linux, major browsers and supported WebViews.
