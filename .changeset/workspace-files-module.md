---
"@agent-native/core": minor
---

Add `workspace-files` module: SQL-backed durable scratch storage for the agent.

- New `workspace_files` table (scope/scope_id/path/content, unique per scope+path).
- Per-file 2 MB cap, per-scope 200 MB cap with clear errors.
- `workspace-files` agent tool (write/append/read/list/delete/grep actions).
- Tool auto-registered in both dev and prod agent loops.
- `workspaceRead`, `workspaceWrite`, `workspaceAppend`, `workspaceList` helpers
  available inside `run-code` sandbox via bridge.
