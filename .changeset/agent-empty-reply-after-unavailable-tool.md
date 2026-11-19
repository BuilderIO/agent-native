---
"@agent-native/core": patch
---

When a run ends with an empty reply right after a tool call was refused as no longer available, it now fails as `tool_unavailable` naming the tool instead of blaming the model's output-token budget.
