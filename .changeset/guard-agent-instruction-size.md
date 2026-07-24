---
"@agent-native/core": patch
---

Add an instruction-size check to `guard:agent-chat-context`. The compact prompt
hard-slices each injected resource at 6,000 characters with no build-time
signal, so template `AGENTS.md` files were silently losing their back half —
analytics lost 39%, including its entire deep-analysis workflow section. The
guard now reports every template's instruction size, fails on a new or growing
overflow, and warns on the templates already over the cap.
