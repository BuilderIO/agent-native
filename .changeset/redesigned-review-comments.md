---
"@agent-native/toolkit": patch
"@agent-native/core": patch
---

Restyle the review comment thread to the new design and add the building blocks Design's canvas card now shares with the sidebar:

- New exports from `@agent-native/toolkit/app/review`: `ReviewThreadCardFrame` (360px card with title bar), `ReviewCommentItem` (root and reply variants), `ReviewThreadMenu`, `ReviewReactionBar`, `ReviewAuthorAvatar`, `ReviewMentionChip`, `ReviewMentionPicker`, `ReviewAgentMark` and `resolveReviewAgent`.
- Agent-authored comments show an `Agent` badge and a brand mark. The mark is chosen from the author name (Claude, Claude Code, Codex), and any other agent gets a neutral mark.
- Replies show the relative age next to the name and the clock time on the right, with a react button and reaction chips under the body. Every comment, including the first, has that react button and those chips. Chips show a count from two reactions up, and 🔥 joins the default reactions.
- `ReviewCommentComposer` is now an editor with inline mention chips and a toolbar for emoji, mention and image. The text it submits and the `mentions` it reports are unchanged. New optional props: `variant` (`"expanded"` or the collapsed `"reply"` pill) and `attachments`. The "Send to agent" button renders only when `agentAction` or `showAgentAction` is passed.
- `ReviewThreadMenu` reads Send to agent, Suggest changes, Reply in thread, Apply changes and resolve, Copy link, Delete thread. The four agent items show only when their handler is passed, and `agentActionsDisabled` turns them off while a hand-off runs. Edit and Mark as unread stay available as optional items.
- The review editor's Tiptap packages are declared in the toolkit's eject manifest, and the migration manifest points `isTrustedReviewAttachmentUrl` at its new home, `ReviewCommentItem`.
