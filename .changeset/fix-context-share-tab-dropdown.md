---
"@agent-native/creative-context": patch
---

Fix the Context tab's dropdown in the Share dialog rendering invisibly behind the host popover and dismissing the whole dialog on interaction. The select now matches the popover's nested-overlay z-index and is marked so `ShareButton` doesn't treat clicks inside it as outside clicks.
