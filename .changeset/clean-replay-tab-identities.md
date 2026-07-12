---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Keep session replay identities isolated per browser tab so recordings from
concurrent or duplicated tabs cannot be merged into a corrupt replay. Preserve
signed DOM stylesheet, font, image, and other load-bearing resource URLs while
continuing to redact navigation and diagnostic URL secrets. Recover long-lived
tabs from replay upload identity conflicts by restarting once with a fresh
snapshot, and report the content-free recovery outcome to Analytics.
Stabilize Dispatch's deferred-navigation behavior under test-runner load.
