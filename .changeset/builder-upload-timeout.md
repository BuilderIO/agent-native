---
"@agent-native/core": patch
---

Add a 2-minute per-attempt timeout to the Builder.io file upload provider fetch so large-image uploads fail with a clear error instead of hanging indefinitely. Retries on network errors are also now handled consistently with the existing 5xx retry path.
