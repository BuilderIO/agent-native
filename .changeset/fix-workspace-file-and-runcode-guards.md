---
"@agent-native/core": patch
---

Fix workspace-file resolution and run-code paging/routing edge cases. `contentFromWorkspaceFile` now resolves the same file the run-code `workspaceRead`/`workspaceWrite` bridge sees (bridge scope first, then Resources), and fails closed on a bridge read error instead of silently falling back to a possibly-different same-path Resources body. `workspaceRead` returns null instead of a silently truncated prefix when a later page fails, and the run-code bridge now returns a distinct "not registered" (404) error for unknown tools instead of a misleading read-only access error.
