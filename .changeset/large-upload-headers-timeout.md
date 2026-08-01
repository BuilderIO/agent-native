---
"@agent-native/core": patch
---

Large Builder uploads are now chunked and retry-safe instead of one all-or-nothing PUT. The signed-URL finalize path uploads through a GCS resumable session in 8MB chunks with per-chunk timeouts and transient-error retries, so a stall on a slow uplink costs one chunk instead of the whole 10-30 minute transfer; if a resumable session cannot be opened it falls back to a single PUT over node:https (fetch's undici transport enforces a ~300s response-headers timeout that a long upload body can never satisfy). Resumable chunk PUTs also gained bounded timeouts.
