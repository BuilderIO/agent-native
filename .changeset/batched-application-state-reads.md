---
"@agent-native/core": patch
---

Batch application-state reads. `GET /_agent-native/application-state?keys=a,b,c`
returns many keys in one request, and `readClientAppState` coalesces reads
issued in the same tick into that single call, so a page load no longer pays one
HTTP round trip and one full identity resolution per key. The response reports
absent keys in `missing` rather than as `null` values, keeping "never written"
distinguishable from "written as null or empty"; the single-key routes are
unchanged.
