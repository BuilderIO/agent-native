---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

`onAgentRunComplete` now receives `{ turnContinues }` so an observer can tell a finished turn from a run that handed off to a continuation run. The retry marker on a recovery message now survives a reload, so a refused prompt is sent again only once across cards, tabs, and reloads, and only AI-setup refusal cards are hidden once a later run starts.
