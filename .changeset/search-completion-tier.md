---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Core's search index ranks a title the query completes just below an exact match: "task prio" puts "Task Priorities" above "Task Priorities board", whichever is newer. Exact title matches are now tier 6 in `matchTier`, completions 5, and the lower tiers keep their numbers. The shared command menu keeps the selected row in view as results change, and moves the highlight to the first result when results reorder without changing how many there are, unless the person has moved the selection themselves.
