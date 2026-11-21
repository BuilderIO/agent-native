---
"@agent-native/core": minor
---

Breaking: replace standalone manifest discovery (`get_app_manifest`, `app://manifest`, `GET /_agent-native/manifest.json`, `deriveAppManifest`, `resolveScreenPath`, and `navigate` `screen`/`params` inputs) with optional, versioned `agent-native/app-capabilities` metadata in the grant-filtered `tools/list` `_meta` catalog (`resolveAppCapabilities(discovery, mount)`). Legacy manifest inputs passed to `defineAppManifest` or `defineAppConfig({ manifest })` are adapted to v1 automatically. Correlate rendered navigation receipts to their target tab and keep background sync opt-in.
