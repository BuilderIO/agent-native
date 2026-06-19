---
"@agent-native/core": patch
---

Diagram blocks now expose a hover-revealed sketchy/clean toggle alongside the
expand button. It flips the shared `plan-wireframe-style` preference, so the
hand-drawn vs. clean choice is global, persisted in localStorage, and synced
across diagrams, wireframes, and tabs in any app that renders the block library.

Diagram primitives also got a polish pass: `.diagram-pill`/badge/chip elements
now hug their label (`width: fit-content`) instead of stretching to fill a flex
column, and `.diagram-node`/`box`/`card`/`panel` carry sensible base padding so
text never touches the box edge when an author diagram omits its own padding.
