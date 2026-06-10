---
"@agent-native/core": patch
---

Add versioned reusable workflow for PR Visual Recap so consumer repos can delegate to `BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml` instead of carrying a full copy. The `agent-native recap setup --reusable` flag writes a thin ~20-line caller; `buildReusableCallerWorkflow` and `writePrVisualRecapReusableCallerWorkflow` are exported for programmatic use.
