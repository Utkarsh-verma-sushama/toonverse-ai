# Checkpoint 37 — AI Coloring & Painting Studio Contract

## Product scope
A non-destructive, offline-first painting and coloring workspace for imported line art, photos, and blank canvases. It supports brush, eraser, tolerance-based fill, eyedropper, color, brush size, opacity, undo/redo, pan-safe zoom, fit-to-view, local autosave/recovery, full-resolution PNG export, and provider-neutral AI Color Assist.

## Platform contract
The responsive web foundation must operate with touch, Apple Pencil/stylus, mouse, keyboard, and TV/D-pad focus across Android phones/tablets/TV, iPhone, iPad, macOS/iMac, Windows, Linux, laptops, desktop monitors, QLED/smart-TV browsers, and standards-compliant Chromium/WebKit/Firefox environments. Layouts reflow below 900px, controls remain at least 46px (52px for coarse pointers), safe-area insets are honored, orientation is unrestricted, and reduced-motion preferences are honored.

## Safety, privacy, reliability
- Originals are never overwritten; exports are new PNG files.
- Media is processed locally unless the user explicitly requests AI assistance.
- AI work uses the existing authenticated, cancellable, provider-neutral job contract and truthfully reports when no backend is configured.
- Accepted uploads are bounded to 40 MB and decoded image types; canvas dimensions are bounded to 4096px per edge for low-memory stability.
- Drafts are debounced and recoverable through IndexedDB.
- History is bounded to 30 full-resolution states to prevent runaway memory.
- CSP, no third-party script dependency, accessible labels, live status, visible focus, keyboard undo/redo, and reduced-motion support are mandatory.

## Acceptance
Brush, eraser, fill, picker, size, opacity, undo, redo, import, blank canvas, zoom, fit, autosave, recovery, PNG export, AI-job preparation, responsive reflow, focus navigation, offline caching, home discovery, and safe failure states must all be present and syntax-validated before lock.
