---
"@agent-native/toolkit": minor
---

Let review comments mention AI agents alongside people:

- New export `ReviewMentionOption` from `@agent-native/toolkit/app/review`: a `ReviewMention` with an optional `description`. `ReviewCommentComposer`'s `mentionOptions` now accepts it. Plain `ReviewMention` lists still work.
- The `@` picker lists agents under an "Agents" heading after the people. Arrow keys and Enter move across people and agents in one list. The heading is set with the new optional `agentsLabel` prop on `ReviewCommentComposer` and `ReviewMentionPicker`.
- The picker's second line shows `description` when a row has no `email`, and the filter matches `description` as well as the name and email.
- Agent names containing `gpt` (for example `GPT-5.4`) get the Codex mark.
