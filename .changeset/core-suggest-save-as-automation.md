---
"@agent-native/core": patch
---

ux(agent prompt): after finishing a task with obvious recurring value (daily triage, weekly digests, monthly cleanup), the agent now offers to save it as a recurring job in one short closing line, then calls `manage-jobs(create)` if the user confirms. Skips the offer for one-shot lookups, single drafts/replies, and prompts that already specify a cadence.
