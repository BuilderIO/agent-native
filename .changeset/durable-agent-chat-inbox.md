---
"@agent-native/agentkit": minor
"@agent-native/core": patch
---

Agent chat now validates durable queued submission receipts against the original session and message identity, preserves retry context after an unreadable acknowledgement, and prevents attachment payloads from being admitted under a mismatched receipt. Queued follow-ups keep their attachment references and drain at completed-turn boundaries.
