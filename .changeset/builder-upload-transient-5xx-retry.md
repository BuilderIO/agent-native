---
"@agent-native/core": patch
---

`builderFileUploadProvider`: retry transient 5xx once with backoff (600ms then 1.8s).

Builder.io's upload service occasionally returns a bodyless 500 ("Internal Error") on the first attempt — usually GCS write hiccups that succeed on retry. Three template surfaces that hit this on every recording / upload (Clips finalize, attachment uploads, generated-image uploads) now get those transient failures absorbed silently. Deterministic 500s still surface to the caller after the third attempt with the original status + body.
