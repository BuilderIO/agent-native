---
"@agent-native/core": patch
---

Collaborator events now go through one typed visibility decision on every delivery path.

- `resolveChangeVisibilityForUser(event, { email, orgId })` answers `"visible"`, `"hidden"`, or `"undetermined"` after a bounded wait for the access check. `"undetermined"` is never treated as a denial. Poll, SSE, and awareness all use it, and awareness events no longer drop a sharee's first presence update while access is being checked.
- `canSeeChangeForUser` is deprecated because it answers `false` while a check is still running. It will be removed in the next minor release.
- An SSE stream handed back to polling now sends a jittered `retry` hint, so collaborators don't reconnect all at once. Hold time is recorded as `agent_native.change_visibility.hold.duration`.
- When an action declares no `changeResource`, its change event now names the one resource the call asserted write access to (`assertAccess(..., "editor")` or a write-level `access.resource`). HTTP, agent, MCP, dev-bridge, and CLI calls all do this. The new `guard:action-change-resource` flags mutating actions that check access only with `resolveAccess` and declare no `changeResource`.
- `recordChange` stamps the writing browser tab as `requestSource` on resource-scoped events, so other viewers detect collaborator activity from any event source instead of a fixed allow-list.
