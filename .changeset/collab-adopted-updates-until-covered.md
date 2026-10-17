---
"@agent-native/core": patch
---

`useCollaborativeDoc` with `durableUpdates` keeps stored updates until the server acknowledges them or the doc's own rebuild replaces them. That covers another tab's updates a doc took up, which were removed once the doc stored its own entry, and the doc's own update the server refused as too large, which was removed at once. A rebuild candidate now names the entries it replaces in the one write that stores it, and a page that opens skips an entry a stored candidate names, so a page that closes or crashes at any point keeps that text once.
