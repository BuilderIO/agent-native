---
"@agent-native/core": minor
---

Collab docs can open from a copy saved in the browser. `useCollaborativeDoc({ localCopy: true })` keeps each doc's acknowledged Yjs state in IndexedDB, per account, cleared on sign-out or account change and bounded by size. A doc opened again is ready from that copy at once (`fromLocalCopy`), then catches up with a diff from the server; a copy the server's doc does not cover is thrown away and the doc reopens from the server. `GET /_agent-native/collab/:docId/state?stateVector=` now also returns the server's state vector (older clients ignore it). `prefetchCollabState(docId)`, from the new `@agent-native/core/client/collab/prefetch` entry, starts that read at page boot.
