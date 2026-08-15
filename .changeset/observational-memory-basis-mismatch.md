---
"@agent-native/core": patch
---

Name the case where an Observational Memory cursor cannot apply to the window it is given. The cursor is a position in whichever message array observed it, and the live agent loop's array counts each tool result separately while the store-derived one folds those into their tool-call parts — so a cursor from the longer basis leaves the thread permanently unable to observe anything, reported identically to "nothing new". It now says so instead.
