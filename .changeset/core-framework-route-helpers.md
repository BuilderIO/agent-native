---
"@agent-native/core": patch
---

Add typed client helpers for the available CLIs, chat checkpoint, and Builder agents-run routes (`fetchAvailableClis`, `listChatCheckpoints`, `restoreChatCheckpoint`, `startBuilderAgentsRun` from `@agent-native/core/client/agent-chat`). Failures throw `FrameworkRouteError` with a `kind` of network, http, or malformed, so a failed read is never an empty result.
