---
"@agent-native/core": patch
---

fix(thread persist): every user message was getting duplicated in `chat_threads` because the runtime export (assistant-ui's `saveThreadData`) wrote `attachments: []` while the server-side `persistSubmittedUserMessage` → `buildUserMessage` path omitted the field entirely. The fingerprint used to dedupe in `messageIdentityKeys` couldn't see them as the same message — `[]` and `undefined` hashed differently. Now normalize the attachments slot through `normalizeAttachmentIdentity` (which collapses both shapes to `undefined`) so duplicates merge instead of stacking up as `client_user → assistant → server_user` triples.
