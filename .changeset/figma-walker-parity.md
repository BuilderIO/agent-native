---
"@agent-native/core": patch
---

Export the fitted Figma blur-radius constant so the REST and `.fig` import
walkers share one value, and stop the fidelity report from describing a text
layer's drop shadow as a `text-shadow` when it is emitted as a `box-shadow`.
