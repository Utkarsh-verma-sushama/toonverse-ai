# Checkpoint 38 — AI Camera & Visual Intelligence Contract

## Scope
A privacy-first, cross-device capture and visual-understanding workspace with live rear/front camera selection, timer, rule-of-thirds grid, optional selfie mirroring, capability-detected torch and optical zoom, local capture/import review, save-as-new image, scene/object/context analysis, OCR, document scan, accessibility descriptions, safety awareness, and free-form visual questions.

## Platform behavior
The web foundation supports Android camera browsers, iPhone/iPad Safari, macOS/iMac, Windows, Linux, laptops, desktops, tablets, Android TV and standards-compliant smart/QLED TV browsers. Devices without a camera or permission fall back to photo import without blocking the workflow. Controls support touch, stylus, mouse, keyboard and D-pad focus; safe-area insets, portrait/landscape reflow, coarse-pointer targets, reduced motion and large-screen scaling are mandatory.

## Privacy, safety and reliability
Camera access is user-initiated, audio is never requested, streams stop on page hide, captured media remains local until explicit Analyze, originals are immutable, and face identification/location extraction are disabled. Uploads are allowlisted and limited to 40 MB; captures are bounded to 4096px per edge. AI analysis uses the authenticated provider-neutral job runtime with truthful offline/backend-unavailable states. CSP blocks third-party execution and embedding.

## Acceptance
Live camera capability detection, import fallback, switch, capture, timer, grid, mirror, torch/zoom detection, local review, save, all analysis modes, progress/result states, privacy disclosures, safe failure states, responsive layouts, accessibility, home/PWA discovery, offline shell and syntax validation must pass before lock.
