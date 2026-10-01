---
"@agent-native/core": minor
"@agent-native/toolkit": patch
---

Actions can declare `changeResource` so their `action` change event also reaches every collaborator who can read that resource, not only the actor. A collaborative editor that never adopts a newer snapshot because its lead peer was not notified now adopts it itself after a grace period, and a server-merged save is no longer mistaken for the editor's own echo.
