---
"@agent-native/core": patch
---

Fix system email sending failing on serverless (ENOENT reading the branding
favicon). The inline email logo is now bundled as a base64 TS module instead of
read from disk at send time, so verification/invite/reset emails work in
production where raw assets aren't traced into the deploy bundle.
