---
"@agent-native/core": patch
---

Take a collaborator's awareness identity from their session: the server sets `user.email` to the session's email, and a session without edit access always advertises `canFlushDocument` and `canFlushTitle` as false. An awareness state that isn't a JSON object is refused with 400.
