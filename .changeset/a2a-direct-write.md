---
"@agent-native/core": patch
---

Add `publicAgent.directWrite` so an app can let a sibling app call one named, owner-scoped write action directly over A2A as the verified signed-in user. Direct A2A calls stay read-only otherwise; the opt-in requires `readOnly: false` and `requiresAuth: true`, is refused for consequential actions and actions that need approval, and keeps the action off the agent card. Such a write runs only for a caller verified as the user; organization credentials, including ones that assert a member, are refused.
