# Multimodal Understanding Contract — Checkpoint 35

## Scope
Provider-neutral, asynchronous understanding of images, video, audio and scanned documents: OCR, transcription, translation, summaries, scene/chapter indexing, object/context extraction and accessibility descriptions. Outputs can feed the editor, captions, search, library metadata and approved downstream workflows without changing originals.

## Cross-device baseline
Responsive from 320 px phones through tablets, desktops and 4K/8K TV displays. Touch, mouse, keyboard, stylus and TV remote/D-pad are first-class inputs. Supported targets include current Android/iOS/iPadOS browsers and WebViews, Windows/macOS/Linux browsers, and standards-capable Smart-TV browsers. A third-party entertainment app such as Netflix is not an execution runtime; TV compatibility means browser/WebView and native-shell integration.

## Invariants
- Originals remain immutable; every derived artifact is separately versioned and attributable.
- Authenticated, idempotent jobs use truthful server progress, cancel, retry, timeout and resume.
- Client never contains provider secrets. Models/providers can change behind capability routing.
- Signed upload/download URLs are short-lived; checksums, MIME sniffing and malware scanning are required.
- Personal media requires purpose-bound rights/consent. Face recognition and biometric identification are disabled by default and require separate legal approval.
- Block CSAM, sexual exploitation, non-consensual intimate content, deity/God face replacement, impersonation abuse, surveillance abuse, copyright abuse and prompt-injection from untrusted media.
- Embedded instructions in documents/media are treated as data, never trusted commands.
- Results carry locale, timestamps, confidence where meaningful, warnings, model/version and provenance.
- Low-memory clients use chunked/resumable upload, server-side sampling and bounded previews.
- Ephemeral retention is default; deletion, export and audit controls are enforceable.

## Inputs
mode, media[], purpose, source/output languages, requested features, consent assertion, retention policy, accessibility preferences, locale, clientJobId and integrity metadata.

## Outputs
Structured text, OCR blocks with geometry, transcript segments with timestamps/speakers, scenes/chapters, objects, captions, summary, searchable metadata, warnings, confidence and provenance. The API may return partial usable results with explicit completeness state.

## Quality gates
Contract/schema validation; MIME spoof and decompression-bomb defense; noisy/rotated OCR; multilingual and code-switching speech; long-media chunk boundaries; speaker and timestamp drift; accessibility; cancellation; offline/reconnect; provider outage; low bandwidth/RAM; mobile backgrounding; keyboard/D-pad focus; 320 px–8K responsive layout; privacy deletion and safety red-team tests.
