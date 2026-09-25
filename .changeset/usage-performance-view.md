---
"@agent-native/core": patch
---

Show a per-prompt performance view on the Settings Usage page: what each prompt cost and did, which tools ran and failed, when the agent had to resend its context, and what the framework handled (parallel tool calls, recovered tool errors). Adds the `get-usage-insights` and `get-usage-run` actions.
