---
"@agent-native/core": patch
---

MCP App widgets now fill a host-owned side panel or fullscreen frame instead of stopping at the inline card height, and apps can detect a widget embed with `isMcpAppWidgetEmbed()` / `useIsMcpAppWidgetEmbed()` to drop their own navigation chrome.
