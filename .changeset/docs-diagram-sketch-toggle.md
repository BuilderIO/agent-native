---
"@agent-native/core": patch
---

Diagram primitives got a polish pass: `.diagram-pill`/badge/chip elements now hug
their label (`width: fit-content`) instead of stretching to fill a flex column,
and `.diagram-node`/`box`/`card`/`panel` carry sensible base padding so text never
touches the box edge when an author diagram omits its own padding.
