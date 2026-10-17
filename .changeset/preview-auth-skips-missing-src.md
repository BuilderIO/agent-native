---
"@agent-native/core": patch
---

The local Design bridge's preview auth shim no longer rewrites a missing `src`/`href` into `/null?previewToken=…`, so appending an image or script that has no source yet stops logging a 404 in live previews.
