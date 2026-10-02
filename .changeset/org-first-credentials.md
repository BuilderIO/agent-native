---
"@agent-native/core": patch
"@agent-native/toolkit": patch
"@agent-native/dispatch": patch
---

Owners and admins now run on their organization's credentials (Builder.io connection, model provider keys, and other keys) ahead of their own, which stay as the fallback; members keep their own first. Key saves default to the organization for owners and admins and ask who can use the key.
