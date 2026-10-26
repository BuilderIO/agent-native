---
"@agent-native/toolkit": patch
---

Smoother streaming replies in AgentKit chat:

- The word reveal follows the measured arrival rate and keeps a steady lag behind the received text, so a server poll's burst spreads over the next few hundred milliseconds instead of landing at once and then stalling. Rate changes ease, no frame reveals more than three words, and the drain after the run ends finishes in well under a second for typical replies. `STREAMING_REVEAL_TARGET_LAG_MS` and `STREAMING_REVEAL_MAX_UNITS_PER_FRAME` replace `streamingRevealSpeed`.
- While pinned to the bottom, the transcript glides to the new bottom as lines wrap instead of jumping a line at a time. Scrolling up still un-pins at once, jump to latest still works, and opening a thread lands at the bottom instantly. Reduced motion scrolls without the glide.
- With reduced motion, replies still reveal at the same steady pace, without the word fade, so a network chunk no longer lands a dozen words at once and the pinned transcript moves a line at a time.
- Table headers and rows stream in cell by cell with the same word fade as prose instead of appearing whole (a header no longer waits for its delimiter row), and table columns slide to their new widths.
- An unclosed bold, italic, strikethrough or inline code run streams in already formatted instead of waiting for its closing delimiter and landing all at once.
- Highlighted code blocks show new lines as they stream, unstyled until the next highlight lands, instead of waiting for it.
