---
"@agent-native/core": patch
---

Fix `MessageRepository(addOrUpdateMessage): Parent message not found` unhandled
rejection in the agent prompt composer (Sentry AGENT-NATIVE-BROWSER-18). The
assistant-ui local runtime can clear or relink its message map between the
`append` that adds the user message and the `performRoundtrip` call that
records the assistant placeholder (history-adapter load, branch reset, repeat
imports). When that race fires the runtime threw an internal-bug error that
masked the original error from chatModel.run() and surfaced as a Sentry
unhandled rejection on the user's first send. The fix patches the underlying
`MessageRepository.addOrUpdateMessage` to relink the message to the current
head (or root) when the requested parent is missing, instead of throwing.
