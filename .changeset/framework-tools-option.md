---
"@agent-native/core": minor
---

Add `frameworkTools` to `createAgentChatPlugin()` so an app can choose which of the framework's own agent tools it exposes — `database`, `extensions`, `sharing`, `review`, `history`, `featureFlags`, `localization`, `audit`, `contextXray`, `userProfile`, `automation`, `docs`, `resources`, `web`, `workspaceApps`, `chat`, and `email`, plus a `"minimal"` preset. Disabling a group removes it from the agent surfaces (chat, MCP, A2A, background runs) while leaving its HTTP action routes mounted for the UI, and drops the prompt blocks that named its tools.

Framework tools are also no longer promoted into the first model request by default: the ~45 sharing/review/history/flag schemas that `autoDiscoverActions` merges in now stay behind `tool-search` unless an app names them in `initialToolNames`. Apps keep every capability and send a much smaller first request.

Deprecates the top-level `databaseTools` and `extensionTools` options in favor of `frameworkTools.database` and `frameworkTools.extensions`. Both are still honored; setting a top-level flag and its `frameworkTools` equivalent to conflicting values now throws at plugin startup instead of booting with an unintended tool surface.
