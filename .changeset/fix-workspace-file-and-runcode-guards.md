---
"@agent-native/core": patch
---

Fix workspace-file resolution and run-code paging edge cases. `contentFromWorkspaceFile` now resolves the same file the run-code `workspaceRead`/`workspaceWrite` bridge sees (bridge scope first, then Resources), and `workspaceRead` returns null instead of a silently truncated prefix when a later page fails.
