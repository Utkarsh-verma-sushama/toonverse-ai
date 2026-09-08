# ToonVerse AI Generation API Contract

Version 1.0 — Checkpoint 31

## Scope
A provider-neutral, asynchronous job service for AI Generate, Photo to Cartoon, Wallpaper, Coloring, Memory, Camera, Image to Text, Video to Text, and Batch workflows.

## Endpoints
- POST /v1/ai/jobs — multipart request; requires Idempotency-Key and authenticated or rate-limited guest context.
- GET /v1/ai/jobs/{id} — status, progress, safe preview/result descriptors, warnings and retry state.
- POST /v1/ai/jobs/{id}/cancel — idempotent cancellation.
- POST /v1/ai/jobs/{id}/retry — server-side retry with a new attempt ID.
- GET /v1/ai/jobs/{id}/events — authenticated SSE/WebSocket-compatible progress stream.
- DELETE /v1/ai/jobs/{id} — delete job outputs according to retention policy.

## Required job states
queued, validating, moderating, uploading, processing, post-processing, completed, partially-completed, failed, cancelled, expired.

## Safety and privacy
- Validate real media signatures, codecs, dimensions, duration and decompression limits server-side.
- Malware scan and sandbox all media decoders.
- Enforce consent for face, memory and personal-media workflows.
- Block sexual exploitation, non-consensual intimate content, deity/God face replacement, impersonation abuse and prohibited content.
- Preserve originals by default; never train on private content without separate explicit opt-in.
- Strip risky metadata from shared outputs while allowing user-controlled preservation where lawful.
- Encrypt uploads and results; use short-lived signed result URLs bound to the user and job.
- Log decisions and correlation IDs without prompts, tokens or private media in routine logs.
- Apply child-safety escalation, abuse throttling and human appeal paths.

## Reliability
- Provider abstraction with capability routing, health checks, circuit breakers and bounded failover.
- Idempotent creation, cancellation and billing.
- Resumable multipart uploads for large media.
- Durable queues, dead-letter handling, job leases, heartbeats and duplicate-execution protection.
- Progress must be truthful; never use artificial timers.
- Partial batch success includes per-item results and errors.
- Exponential backoff with jitter only for retry-safe operations.
- Offline clients retain metadata locally and resubmit only after explicit capability/auth checks.
- Outputs have checksums, provenance fields, model/version identifiers and reproducibility metadata where supported.

## Performance
- Device-aware client upload limits and server-side quotas.
- Thumbnail/proxy workflows for preview; originals used only where output quality requires them.
- Streaming upload/download, adaptive concurrency, cancellation propagation and memory budgets.
- Provider and model selection based on requested quality, latency, cost, format, region and safety.
- No secret keys or provider credentials in browser code.

## Response minimum
Job responses include id, status, progress (0–100), mode, createdAt, updatedAt, warnings, retryable, outputs, and stable errorCode. Each output includes type, mimeType, width/height or duration when relevant, checksum, downloadUrl, expiresAt, and safety/provenance metadata.

## Production verification
Unit, contract, integration, load, chaos, security, moderation, privacy, accessibility and end-to-end tests are mandatory. Validate Android, iOS/iPadOS, Windows, macOS, Linux, modern browsers, WebViews, slow networks, offline transitions, low memory, large files, cancellation, retries, partial batches and provider outages.
