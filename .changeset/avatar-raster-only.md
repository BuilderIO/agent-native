---
"@agent-native/core": patch
---

Reject SVG and non-raster MIME types on avatar write to prevent stored-XSS via data:image/svg+xml payloads.
