---
"@agent-native/recap-cli": patch
---

Cap the visual-recap skill's browser render-inspect-fix loop at one re-render, and note that the recap's canonical shape/budgets are also a cost ceiling, to keep interactive recap generation from re-iterating or re-reading the full diff indefinitely.
