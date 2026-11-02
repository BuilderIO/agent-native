---
"@agent-native/core": patch
---

Persist private approval history under the server-created approval ID instead of a deterministic digest of tool input. Bind approval grants with server-keyed digests so stored rows cannot be checked against guessed input offline. Existing pending grants from before this change, or grants whose server encryption key rotates, require a new approval; live approval and exact-call checks remain in place.
