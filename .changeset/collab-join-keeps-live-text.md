---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

A tab opening a shared document no longer deletes another tab's unsaved text. When an editor using `useCollabReconcile` sets the new `discoverCollabPeers` and `flushCollabUpdates` options (with `requestCollabSync`) and opens onto a live document that differs from the stored body, it learns who else is open and catches up with the server. It then keeps the document if a collaborator reports holding the stored revision or a newer one. Each such client reports its revision in awareness as `reconciledRevision`, but only after the server has every update behind it. Without a report, or without the options, the editor applies the stored body as before. `useCollaborativeDoc` gains `discoverPeers()`: one presence request that resolves `ready`, `failed` (including an unreadable answer) or `unavailable`, and that runs even in a hidden tab.
