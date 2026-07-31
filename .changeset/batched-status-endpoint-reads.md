---
"@agent-native/core": patch
---

Cut database round trips on the status endpoints a page load hits repeatedly.

- Added `prefetchSecrets(keys)`, which warms the per-request secret memo with
  one batched read per scope instead of one read per key per scope, and used it
  in `/_agent-native/env-status` (48 single-key `app_secrets` selects per request
  → 4 batched) and `/_agent-native/voice-providers/status` (19 → 4).
- The change marker after an action now honours a per-call Plan-mode `effect`
  before the action-level `readOnly` flag. A status poll shaped as a mutating
  action — `manage-agent-engine` with `action: "list"`, polled every few seconds
  — no longer bumps the `"action"` change version, so queries keyed on it stop
  refetching on an idle page.
- The default database schema health probe runs its table checks in parallel and
  memoizes a clean result for a few seconds. A probe reporting a missing table or
  an unreadable database is never memoized.
