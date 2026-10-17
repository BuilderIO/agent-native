---
"@agent-native/core": patch
---

`useCollaborativeDoc` with `durableUpdates` starts the doc over from the server's copy when the signed-in user's email changes, so typing under the new account no longer builds on content the previous account kept or the server refused. `ydoc` is null until the new doc loads.
