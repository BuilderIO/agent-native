---
"@agent-native/core": patch
---

Harden MCP host integration against ticket and content leaks. Strip embed-ticket URLs from any tool result text even when the action does not declare `mcpApp.resource`. Filter `embedTargetPath`, `embedExpiresAt`, and `ticket`-like fields from MCP structured content (their legitimate carrier is `_meta["agent-native/embedStart"]`). Stop fabricating an `_meta["agent-native/openLink"]` `webUrl` from a bare view name like `"deck"` when the action returns only an embed-start URL. Remove the now-unused `compose` field from `buildDeepLink` so deep-link URLs cannot inline draft contents. Make `isEmbedMcpChatBridgeActive` keep the in-memory bridge flag once enrolled so sandboxed iframes that deny sessionStorage no longer silently drop chat-bridge mode mid-session.
