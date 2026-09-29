---
"@agent-native/core": patch
---

Restore how Builder.io connections were stored and read before the Settings redesign. Account activation from a prompt that doesn't name the organization connection saves the new account personally for every role again, so an owner or admin can no longer replace the organization's Builder account by activating from it. Every role runs on their own Builder connection first and the organization's second, as before.
