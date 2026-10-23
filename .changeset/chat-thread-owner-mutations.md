---
"@agent-native/core": minor
---

Require chat thread ownership to pin, unpin, archive, unarchive or rename a thread through HTTP routes, snapshot saves, agent tools and store helpers. Breaking: `setThreadPinned` and `setThreadArchived` from `@agent-native/core/server` now require an `{ ownerEmail }` option and throw `ForbiddenError` for non-owners; pass the signed-in user's email. A shared editor's message saves keep the owner's title.
