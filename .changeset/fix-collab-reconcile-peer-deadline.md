---
"@agent-native/toolkit": patch
---

Keep collaborative editors from briefly reverting edits received from another editor while SQL catches up, or indefinitely postponing accepted external content during presence updates.

Advance the edit baseline when peer-delivered content already matches an accepted snapshot, preventing false conflicts on subsequent edits.

Preserve subsequent local edits when an accepted replacement arrives through live sync before its saved revision, without treating identical shared changes as conflicts.
