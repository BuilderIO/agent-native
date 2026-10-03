---
"@agent-native/toolkit": patch
---

`SharedRichEditor` takes `onRemoteSnapshotChange` and reports a collaborator's text arriving through the live document, so an editor that saves from the document can save what their typing left unsaved. `useCollabReconcile` also adopts a new `value` that arrives after its `contentUpdatedAt` did; the render in between used to mark that revision applied and the new value was never adopted.
