---
"@agent-native/core": patch
---

Read a line's `a:headEnd`/`a:tailEnd` decorations when importing a PPTX. A connector that terminates in a round dot at both ends — 11 of the 18 connectors on one real SlidesMania deck — imported as a bare rule, because the parser stopped at the stroke's colour and width. Ends of every type are now recorded on the element, including the ones a renderer cannot draw, so a skipped end stays distinguishable from a line the source drew bare.
