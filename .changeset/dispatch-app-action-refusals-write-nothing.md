---
"@agent-native/dispatch": patch
---

A Dispatch app action that the app refuses before running (invalid parameters, an action the app doesn't have, a call that was never sent) now reports that nothing was changed, instead of "write outcome may be unknown". One mistyped call no longer stops the rest of the turn's app actions, reads included, in every app.
