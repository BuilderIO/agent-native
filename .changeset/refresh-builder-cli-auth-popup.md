---
"@agent-native/core": patch
---

Always refresh the Builder cli-auth URL inside a freshly-opened about:blank popup on web (desktop keeps direct path), add a stable `authError` field to BuilderStatus for persisted old-credential rejection, and keep Fusion/workspace-runtime deploy keys out of the identity fallback when a signed-in user is present.
