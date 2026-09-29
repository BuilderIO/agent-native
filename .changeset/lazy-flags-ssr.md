---
"@agent-native/core": patch
---

Load LaunchDarkly evaluation only when its action runs so unrelated app cold starts do not load the server SDK.
