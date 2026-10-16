---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

A tab opening a shared document no longer deletes another tab's unsaved text. Opening onto a live document that already holds text ahead of the stored body, an editor using `useCollabReconcile` with the new `discoverCollabPeers` option now waits to learn who else is open and keeps that text when a collaborator reports its document already holds the stored revision; it then reports its own revision in awareness as `reconciledRevision`. Without such a report, or without the option, it applies the stored body as before. `useCollaborativeDoc` gains `discoverPeers()`, one presence request that resolves `ready`, `failed` or `unavailable`, and runs while the tab is hidden.
