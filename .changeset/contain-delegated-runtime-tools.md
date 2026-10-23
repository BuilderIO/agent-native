---
"@agent-native/core": patch
---

Keep framework runtime tools out of runs started through `ask_app` or A2A, retaining app actions and a bundled static documentation reader. Delegated app actions retain their action-owned approval predicates and tool caller semantics, with outside network provenance preserved through approval replay. Automations created or modified by outside callers require approval, retain sticky outside provenance, and require approval for each write when run. Add the shared `isOutsideAgentCall` helper for outside-call policy.
