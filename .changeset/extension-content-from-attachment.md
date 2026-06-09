---
"@agent-native/core": patch
---

`create-extension` and `update-extension` can now host a large pasted file by
reference. When a user pastes a big HTML/Alpine file and asks to host it as an
extension, the model passes `contentFromAttachment` (the pasted attachment's
name, or the literal `"latest"`) instead of copying the whole file into the
`content` tool argument. The server resolves it from the turn's attachments —
which the agent loop now threads into each action's `ActionRunContext` — so the
model never re-emits thousands of tokens of pasted content.

Re-emitting a large paste as `content` was the root cause of the
create-extension continuation loop the repetition guard mitigates; this removes
the need to regurgitate it at all. The inline `content` path is unchanged.
