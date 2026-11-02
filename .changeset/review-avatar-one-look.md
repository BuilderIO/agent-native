---
"@agent-native/toolkit": patch
---

`ReviewAuthorAvatar` is now the one avatar for a person on every review surface, and the `@` picker's `ReviewMentionAvatar` uses it too. It shows their photo when they have one and otherwise their initials ("EA") on a color that stays the same for that person, from the `--review-avatar-1` to `--review-avatar-6` tokens when an app defines them and a dark gray when it does not. It gains a 16px size (one letter) and a `decorative` prop, an agent shows its brand mark, and `reviewInitials` is exported. Initials now skip words that have no letter in them.
