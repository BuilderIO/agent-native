---
"@agent-native/core": patch
---

Diagram blocks now expose a hover-revealed sketchy/clean toggle alongside the
expand button. It flips the shared `plan-wireframe-style` preference, so the
hand-drawn vs. clean choice is global, persisted in localStorage, and synced
across diagrams, wireframes, and tabs in any app that renders the block library.
