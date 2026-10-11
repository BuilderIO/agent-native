---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Expose a run's resolved thinking effort on its request run context and to `onEngineResolved`. `onEngineResolved` is also called before each model call, so the run context follows a rate-limit fallback to another model and the lower effort an empty-response retry steps down to; an action records the model and effort its call actually used. `runAgentLoop` reports these through `onModelSettings`. Export the composer's `MentionChip` so sent messages can draw mentions exactly as the composer does. `InlineMarkdown` protects spans in one pass, so a shorter span is never matched again inside a longer one's label, and a span can name the one occurrence it protects with `at`. The `@` popover can show why host mention items failed to load, with a Retry action, through `mentionItemsError` and `onRetryMentionItems`.
