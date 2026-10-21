---
"@agent-native/core": patch
---

Require chat thread ownership to pin, unpin, archive, unarchive or rename a thread through HTTP routes, snapshot saves, agent tools and store helpers. Store mutation helpers now require the caller's ownerEmail option and throw ForbiddenError for non-owners.
