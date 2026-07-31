---
"@agent-native/dispatch": patch
---

Add a read-only `read-slack-thread-context` action for Slack-linked issue triage. It resolves child permalinks to their parent thread, returns message attachments and related links, and reports incomplete pagination instead of silently treating a partial thread as complete.
