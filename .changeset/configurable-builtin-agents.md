---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Let workspaces choose which hosted first-party apps they offer with `agent-native.builtinAgents` (`mode: "all" | "none" | "selected"`, `include`) in the root or standalone `package.json`. Dispatch's app list now follows that config instead of always adding the chat-first defaults, and local workspaces outside the framework repo link built-ins to their hosted URLs.
