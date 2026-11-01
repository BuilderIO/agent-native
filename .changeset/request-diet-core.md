---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fewer requests on page load. The WebMCP manifest now carries an ETag with `Cache-Control: private, no-cache`, so a warm load revalidates it with a bodyless 304 instead of downloading it again. A page that sends action writes as it opens can call the new `prepareUiActionCapability()` to mint the UI write capability as soon as a signed-in session is known, so its first write doesn't wait behind the mint; other pages still mint on their first write. A reload inside the capability's reuse window skips the mint, and the remembered capability is forgotten on sign-out and when the account or organization changes. `useActionQuery` takes a new `batchFirstFetch` option for reads nothing on first paint waits for: their first fetch shares a `get-actions-batch` request with the other GETs in its tick. The org switcher's profile read opts in; feature flags and labs don't, since a flag can decide what the page shows.
