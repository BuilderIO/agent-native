---
"@agent-native/core": patch
---

Once `updatesRefused` turns true, `useCollaborativeDoc` stops keeping the doc's unsent updates, in localStorage or in memory for the page's next visit, so neither a reload nor a revisit sends the refused update again. The new `rebuild(write)` saves the doc again: `write` puts the caller's content onto the server's copy, and the hook moves to a new doc, under a new client id, that sends it as one update. While that update would still be refused, `rebuild` resolves `too_large` and keeps it under a key of its own, which the tab holds as a Web Lock: another tab adopts it only once this one is gone. The collab routes' default payload limit and the live copy's default size limit now come from shared constants, and `collabUpdateFits(updateBytes, resultingStateBytes)` tells a client whether the server would take an update that leaves the document at a given size.
