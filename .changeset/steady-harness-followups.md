---
"@agent-native/core": patch
---

Persist AgentHarness follow-up intent and transcript events so expired work can be reconciled without replaying uncertain actions, preserve order across run and session journals, and run native follow-ups through the shared leased driver with their original run budget.
