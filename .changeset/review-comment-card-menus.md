---
"@agent-native/toolkit": patch
---

Review comments can carry their own menu: the new `ReviewCommentMenu` (Edit, Delete) goes in `ReviewCommentItem`'s new `menu` slot, which replaces the reply clock time (a comment now shows only its age). The card's resolve, close and More actions buttons show tooltips, `ReviewThreadMenu` drops its "Reply in thread" item, and `ReviewCommentComposer` reports the text after an `@` through `onMentionQueryChange` (and again with an empty query when it unmounts) so a host can search its people list server-side. While the host's `mentionOptionsLoading` is true and nothing in the list matches yet, the picker stays hidden instead of saying no one was found.
