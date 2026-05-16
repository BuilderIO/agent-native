---
"@agent-native/core": patch
---

Fix agent sidebar resurrecting an old closed tab on refresh. When all tabs were closed down to a single new empty tab, reloading the page replaced it with the most-recent old conversation because the empty tab is never persisted server-side and the in-memory newly-created marker is wiped by the reload. The saved tab is now restored verbatim as an optimistic empty tab instead of falling back to an unrelated old chat. Stale (>12h) tab clearing is unchanged.
