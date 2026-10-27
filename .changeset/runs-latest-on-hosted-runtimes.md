---
"@agent-native/core": patch
---

Agent chat now continues a run that hits its time limit on hosts like Netlify. There, `/runs/latest` never matched its route and fell through to `/runs/active`, which reports a time-limit stop as finished, so the browser stopped the turn with no message instead of continuing it. `/runs/active` now answers only its own path.
