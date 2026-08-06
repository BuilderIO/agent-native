---
"@agent-native/core": patch
---

Stop ending long agent chat turns early. The client's whole-turn follow budget was shorter than a single background chunk the server is allowed to run, so turns that were still streaming were cut off; it is now a backstop above the server's own limits, with a test pinning that order. Also explains the gateway's email-verification block instead of showing a dead-end error, and no longer claims a stopped turn was looping when it was still working.
