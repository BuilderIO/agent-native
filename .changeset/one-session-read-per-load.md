---
"@agent-native/core": patch
---

Answer every session read on a page load from the shell's bootstrap read, even after the page wraps `fetch`, and add `firstSessionReadAnswer` and `subscribeFirstSessionReadAnswer` so an app can tell whether reads it sent before the session answered still belong to the signed-in account.
