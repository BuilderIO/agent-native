---
"@agent-native/core": patch
---

Explain agent runs in the Observability dashboard: the Overview tab now summarizes spend, completion, and what the framework handled (parallel tool calls, recovered tool errors) with grouped "worth a look" findings, and the Conversations tab shows each prompt in plain language (what it did, which tools failed and why, what it cost per step) with the raw span trace one click away. Adds the `get-usage-insights` and `get-usage-run` actions.
