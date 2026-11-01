---
"@agent-native/core": patch
---

Fewer requests on page load. The WebMCP manifest now carries an ETag with `Cache-Control: private, no-cache`, so a warm load revalidates it with a bodyless 304 instead of downloading it again. A page that sends action writes as it opens can call the new `prepareUiActionCapability()` to mint the UI write capability as soon as a signed-in session is known, so its first write doesn't wait behind the mint; other pages still mint on their first write. A reload inside the capability's reuse window skips the mint, and the remembered capability is forgotten on sign-out and when the account or organization changes.
