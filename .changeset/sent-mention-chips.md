---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Expose a run's resolved thinking effort on its request run context and to `onEngineResolved`; the context follows the effort an empty-response retry steps down to, so an action records the effort its call actually ran at. Export the composer's `MentionChip` so sent messages can draw mentions exactly as the composer does. `InlineMarkdown` protects spans in one pass, so a shorter span is never matched again inside a longer one's label, and a span can name the one occurrence it protects with `at`. The `@` popover can show why host mention items failed to load, with a Retry action, through `mentionItemsError` and `onRetryMentionItems`.
