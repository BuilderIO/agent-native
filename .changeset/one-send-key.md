---
"@agent-native/toolkit": minor
---

One send key in every comment box: Enter sends, Shift+Enter starts a new line, and Cmd/Ctrl+Enter sends too. Nothing sends while an input method is composing, so Enter can confirm a Japanese, Chinese or Korean word.

- New `isCommentSendKey()` and `isComposingKey()` from `@agent-native/toolkit/app/review` check a keydown against that rule.
- `ReviewCommentComposer` now sends on Enter by default. Pass `submitOnEnter={false}` to keep Enter for new lines; Cmd/Ctrl+Enter then still sends, where before it did nothing.
