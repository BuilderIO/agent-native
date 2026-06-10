---
"@agent-native/core": patch
---

Fix CLI safety issues: scope isFirstPartyPlanHost to plan.agent-native.com only, exclude diff headers from countDiffLines, raise waitForPublicRecapImage retry budget to ~20s, detect git failures in collect-diff, guard codex mcp-config against clobbering existing config, require PLAN_RECAP_TOKEN for claude mcp-config, and fix plan-local unknown-area exit code.
