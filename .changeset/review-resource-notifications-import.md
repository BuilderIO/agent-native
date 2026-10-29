---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Review threads can now be adopted by any app without losing its own comment emails or history. `registerReviewableResource` takes `commentNotifications` (a preference key, a transactional template id, a thread link, and an email renderer), so mention, reply, and new-comment emails can link straight to the thread and respect the app's existing email setting. `importReviewComments` copies comments from an older store into review threads once, keeping ids, timestamps, resolved state, and reactions, and never emails anyone. The agent `@` mention helpers (`agentMentionId`, `modelDisplayName`, `reviewAgentSelections`, `useReviewAgentMentions`, and friends) now live in `@agent-native/core/review/agent-identity` and `@agent-native/toolkit/app/review` instead of the Design template. The toolkit also gains the threads list (`ReviewThreadsPanel`, `ReviewThreadRow`, `ReviewInitialAvatar`), the canvas `ReviewPinBadge`, and a `draft` composer variant that stays one line until there is something to send.
