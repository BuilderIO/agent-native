---
"@agent-native/toolkit": patch
---

Let hosts style the shared composer for non-agent prompts: a stacked `@` menu density with larger avatars, `insertTextAtCursor` on the composer handle, a `requireAgentEngine` opt-out so a missing API key never blocks a human comment, data attributes on inline mention pills, and filtering of host-supplied `@` items by the typed query so Enter picks the matching item.
