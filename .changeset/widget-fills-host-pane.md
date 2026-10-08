---
"@agent-native/core": patch
---

MCP App widgets now fill a host-owned side panel or fullscreen frame instead of stopping at the inline card height, apps can detect a widget embed with `isMcpAppWidgetEmbed()` / `useIsMcpAppWidgetEmbed()` to drop their own navigation chrome, directory MCP servers attach the widget only to tools listed in `widgetTargets` so read tools no longer open a pane on every call, and a read-only directory widget session (`isMcpDirectoryWidgetReadOnlyEmbed()`) answers application-state requests the server would refuse with the same 401 locally, so callers behave as before without the failed request.
