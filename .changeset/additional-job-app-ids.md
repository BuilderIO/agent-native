---
"@agent-native/core": patch
---

Add `additionalJobAppIds` to `createAgentChatPlugin`: job `appId` values the app's scheduler runs besides its own `appId`. An app can label some job files this way so that an older build, which runs only its own `appId`, skips them. The scheduler lease, run history and health rows stay under `appId`. `queueAutomationRunNow` takes the same list for **Run now**, and `jobBelongsToApp` takes it as an optional third argument.
