---
"@agent-native/core": patch
---

`AgentPanel` no longer emits a synthetic `{ open: false }` sidebar-state event on mount when the parent frame owns the sidebar. The dispatch is now deferred until the frame sends its first `agentNative.sidebarMode` message, so listeners initialize with the real state instead of seeing a false → true flip a moment later.
