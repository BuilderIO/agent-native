---
"@agent-native/toolkit": minor
"@agent-native/agentkit": minor
"@agent-native/core": patch
---

Add opt-in hierarchical composer context menus, attachment status and recovery controls, bounded immutable context snapshots, and a shared quick-start submission handle. AgentKit awaits a beforeSend hook and carries the same context metadata through immediate and queued submissions. Composer drafts, files, and context can be staged before provider setup while submission remains gated; hosts can use `submissionDisabled` without disabling staging.
