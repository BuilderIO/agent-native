---
"@agent-native/core": minor
"@agent-native/dispatch": patch
---

Add the authenticated, nonce-only completion route used by packaged Desktop clients during cross-app identity federation.

Let Dispatch register rollout-gated identity routes on its primary auth guard so security checks remain unconditional while the capability is default-off.
