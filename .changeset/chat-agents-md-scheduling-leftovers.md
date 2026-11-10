---
"@agent-native/core": patch
---

New Chat and Builder starter apps no longer tell their coding agent to check "overlap rejection" and "cancellation freeing the slot" in its browser smoke test. Those steps were left over from the scheduling template, and Chat has no slots, so an agent following them went looking for a feature that does not exist.
