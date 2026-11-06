---
"@agent-native/core": patch
"@agent-native/agentkit": patch
---

Non-image chat attachments uploaded to Builder storage no longer fail the agent run with "An attachment has inline bytes but no durable file URL". Builder's file download URL (`/o/<object>?alt=media&token=…`) now counts as a durable reference, and the client, thread storage, and background dispatch all share one rule for it.
