---
"@agent-native/core": patch
---

Close four gaps left after the server shutdown fix. A Google Docs document whose comment check fails is checked again on later polls (up to five) instead of being skipped for good once the change cursor moves past it. The Drive watch-channel stop request times out after 10 seconds, so a stalled request can't hold up turning Docs off. Shutdown now waits, within its existing 5-second limit, for sandbox runs this process is executing before a dev server closes their database. A closing dev server waits at most 5 seconds for its PGlite database before exiting without it.
