---
"@agent-native/dispatch": patch
---

Wire `scaffold-workspace-app`, `unarchive-workspace-app`, `remove-pending-workspace-app`, and `list-available-workspace-templates` into the `dispatchActions` registry. Followup to the actions added in the previous release — they were imported but never exposed to the agent.
