---
"@agent-native/core": minor
---

Require chat thread ownership to change the owner's pin or archive state or rename a thread through HTTP routes, snapshot saves, agent tools and store helpers. Shared viewers can still pin and unpin a thread personally without changing the owner's pin state; archive, unarchive and rename remain owner-only. Breaking: `setThreadPinned` and `setThreadArchived` from `@agent-native/core/server` now require an `{ ownerEmail }` option; pass the signed-in user's email. `setThreadPinned` checks shared-thread access for personal pins, while `setThreadArchived` rejects non-owners with `ForbiddenError`. A shared editor's message saves keep the owner's title.
