# Cross-platform foundation

The web shell is the shared product core. Capacitor packages Android and iOS. Installable PWA mode covers modern Windows, macOS, Linux and ChromeOS while dedicated desktop/store wrappers remain a later release choice. TV uses the responsive web/PWA shell with D-pad spatial focus and overscan-safe spacing; store-specific Android TV, tvOS, Tizen and webOS packages require vendor accounts and device certification.

## Included now

- Runtime platform/input detection without invasive fingerprinting.
- Touch, mouse, keyboard, stylus-compatible web controls plus TV D-pad spatial navigation.
- Safe-area and TV overscan tokens.
- Reduced-motion, high-contrast and data-saver awareness.
- Low-memory/network-aware workload budgets.
- Online/offline and connection-change events.
- Storage quota/pressure visibility and persistent-storage capability detection.
- Shared responsive PWA and Capacitor asset pipeline.
- Safe feature flags for cloud, agents and multimodal routing.
- Automated core, web, Android and iOS validation.

## Required before each store/device release

Real-device screen-reader, keyboard, touch, stylus and remote-control tests; orientation/foldable checks; permission review; signed builds; crash/performance telemetry; store privacy disclosures; platform-specific purchase rules; deep-link verification; backup/restore; update/rollback; and device lab coverage.

Platform emulation or source code alone must never be described as certified on a physical device.
