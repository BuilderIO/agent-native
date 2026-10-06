---
"@agent-native/core": patch
---

Recover exactly the automation runs a stopped worker left behind: settle every unfinished run past its liveness window instead of only the newest, leave a queued "Run now" dispatch alone while its claim lease is still valid, and finish a run only while the stored claim is unchanged from the one that was read. A queued run is no longer cancelled or overwritten before its worker starts, the stale run it hid behind is no longer left open, and a failed history write no longer stops the remaining runs from being settled.
