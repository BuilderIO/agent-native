---
"@agent-native/core": minor
---

Add a `reasoningEffort` field to job/automation frontmatter, the background automation runner, `automations/service.ts`, `list-automations`, and the `manage-jobs` tool, so a scheduled automation can request an explicit reasoning effort instead of always inheriting the model's default.
