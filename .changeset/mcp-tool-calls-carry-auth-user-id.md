---
"@agent-native/core": patch
---

MCP tool calls from a verified user now carry that user's Better Auth id in the request context (`authUserId`), as browser sessions do. Gates keyed on it, such as Clips' free hosted storage, now treat an MCP caller like the same user in the browser. A failed lookup fails the call instead of running it as a user with no account.
