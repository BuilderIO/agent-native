---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Make MCP Apps cards in Claude, ChatGPT and other chat apps a per-person lab, "App cards in chat apps", that anyone can turn on in Settings → Labs. Every app that mounts an MCP server lists it, off by default. Breaking: the `AGENT_NATIVE_MCP_APPS_INLINE` and `AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS` environment variables are removed and no longer turn cards on; the server logs one warning if either is still set. People who relied on them turn the lab on and reconnect the app in their chat app. The ChatGPT app-directory catalog and first-party callers still get cards without the lab.
