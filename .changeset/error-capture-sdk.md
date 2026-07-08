---
"@agent-native/core": minor
---

Add first-party, Sentry-style error capture to the analytics client SDK. `configureTracking({ errorCapture })` now auto-captures uncaught exceptions (`window.onerror`) and unhandled promise rejections, exposes a manual `captureException(error, context?)` / `captureMessage(message, level?)` API plus `addErrorBreadcrumb`, and ties each captured exception to the active session replay id so errors link straight to the recording they happened in. Captured exceptions are sent through the existing first-party analytics ingest as a dedicated `$exception` event and are redacted + deduped client-side. Additive and backward-compatible; error capture only installs when a public key is configured (or explicitly enabled).
