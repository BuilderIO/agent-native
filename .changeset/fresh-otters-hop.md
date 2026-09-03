---
"@agent-native/core": patch
---

Fix the default social/OG image's advertised MIME type to match the actual asset (JPEG, not PNG) via a new `AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE_TYPE` export, and add the guard's documented opt-out pragma to the fixed brand-palette color literals in the OG image generators. Bump `AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER` so the rebranded dynamic OG image isn't served stale from CDN/browser caches.
