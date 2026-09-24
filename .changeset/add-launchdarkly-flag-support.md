---
"@agent-native/core": minor
---

Add LaunchDarkly flag support: `@agent-native/core/launchdarkly` for server code, `@agent-native/core/client/launchdarkly` for browser hooks (`useLaunchDarklyFlag`, `useLaunchDarklyFlags`), and the auto-mounted `get-launchdarkly-flags` action. Configure with the `LAUNCHDARKLY_SDK_KEY` environment variable; every read fails closed to its caller-supplied default when unconfigured, unreachable, or slow.
