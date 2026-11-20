---
"@agent-native/core": patch
---

Return a successful, typed `{ kept: true, navigated: false, reason, currentView, message }` result instead of throwing `AgentNavigationRefusedError` when an agent `navigate` call would move the user off their current view without `intent: "open"` (for detail views or during/after agent writes). Direct `navigate` writes from read-only actions and non-navigate write actions remain refused so reads and writes never move the user's view.
