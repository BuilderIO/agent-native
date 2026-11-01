---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fewer requests on page load. The WebMCP manifest now carries an ETag with `Cache-Control: private, no-cache`, so a warm load revalidates it with a bodyless 304 instead of downloading it again. The UI write capability is minted as soon as a signed-in session is known, and a reload inside its reuse window skips the mint, so the first write no longer waits behind it. `useActionQuery` takes a new `batchFirstFetch` option for reads nothing on first paint waits for: their first fetch shares a `get-actions-batch` request with the other GETs in its tick. Feature flags, labs and the org switcher's profile read opt in.
