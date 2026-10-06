---
"@agent-native/toolkit": patch
---

A collaborative editor no longer doubles a peer's text when a saved revision carrying it arrives before the peer's Yjs update. The editor now catches its live document up before merging any snapshot that is not collab-backed, not only revision-less ones. A failed catch-up is retried twice before the editor merges the snapshot without it.
