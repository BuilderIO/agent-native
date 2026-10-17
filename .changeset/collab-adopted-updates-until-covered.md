---
"@agent-native/core": patch
---

`useCollaborativeDoc` with `durableUpdates` keeps stored updates until the server acknowledges them or another stored entry of the doc takes them over. That covers the doc's own update the server refused as too large, which was removed at once, and another tab's updates a doc took up. An entry that takes over other entries, the doc's own entry or its rebuild candidate, now names them in the one write that stores it, and a page that opens skips an entry a stored one names. A page that closes or crashes at any point keeps that text stored. Two pages can still take up the same edits, and keep them twice, when one is granted a closed tab's lock before it reads the other's writes.
