---
"@agent-native/core": patch
---

Export `./styles/agent-conversation.css` from the package so consumers outside the monorepo (like the desktop app) can import it by package specifier instead of a fragile source-relative path.
