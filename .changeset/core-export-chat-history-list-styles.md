---
"@agent-native/core": patch
---

Export `./styles/chat-history-list.css` from the package so non-Tailwind hosts (like `@agent-native/code-agents-ui`) can import the shared `ChatHistoryList` stylesheet by package specifier instead of a fragile source-relative path.
