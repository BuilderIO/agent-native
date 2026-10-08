---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

An MCP App widget document now stays a widget for its whole life: `isMcpAppWidgetEmbed()` keeps its first positive answer and marks `<html data-agent-native-mcp-widget>`, `useIsMcpAppWidgetEmbed()` subscribes to that change, a directory widget capability token identifies a widget without the chat-bridge query flag, and `/_agent-native/embed/start` always adds the flag for directory widget tickets. `AppProviders` emits a first-paint script that sets the marker before the server-rendered skeleton paints, and `AppShellSkeleton` renders blank in a widget so the app's own sidebar never flashes.
