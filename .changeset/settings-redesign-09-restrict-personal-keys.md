---
"@agent-native/core": minor
---

Add "Restrict personal API keys", an organization setting owners and admins change with the new `manage-provider-key-policy` action. While it is on, members' own model provider keys and personal Builder.io connection are skipped by every credential resolver (their chats use organization providers), members can't save new personal provider keys or connect a personal Builder.io account, and a chat with no usable key says "Owners and admins restricted personal API keys." Owners and admins keep their own keys, nothing is deleted, and turning it off restores members' keys. Reading the setting as an owner or admin lists each affected member and the providers that stop, and every change is audited.
