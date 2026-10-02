---
"@agent-native/toolkit": patch
---

`SharedRichEditor` accepts `requestCollabSync`. For a snapshot without a revision, an editor on a live document now catches up with the server's Yjs state before adopting the snapshot, because on a polling-only host a collaborator's saved text reaches a tab before the Yjs updates that carry it, and applying the snapshot first inserted that text twice.
