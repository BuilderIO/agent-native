---
"@agent-native/core": patch
---

The Design localhost bridge now proxies a live frame's navigation to the app's root path instead of answering it with the bridge's own control-plane manifest, so a router redirect or home link inside a visual-edit screen no longer replaces the app with JSON.
