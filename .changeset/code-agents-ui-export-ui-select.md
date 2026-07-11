---
"@agent-native/code-agents-ui": patch
---

Export `./ui/select` so consumers outside the package (like the desktop app) can import the shared, theme-aware Select components by package specifier instead of maintaining a duplicate copy.
