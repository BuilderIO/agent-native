---
"@agent-native/core": patch
---

Keep framework runtime tools out of runs started through `ask_app` or A2A, retaining app actions and a bundled static documentation reader. Preserve tool caller semantics and outside network provenance through approval replay. Require outside approval on framework automation management, Factory prompt-automation create/save/restore/run actions, and Analytics' index scheduler. Covered creation and edit paths record outside provenance; marked runs require approval for each write. A store-wide provenance guarantee for other write paths is separate follow-up work. Add the shared `isOutsideAgentCall` helper for outside-call policy.

Factory prompt automations: Single-line automation settings now reject line breaks.
