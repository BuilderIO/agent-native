---
"@agent-native/core": patch
---

Recap code-diff blocks: fix duplicate/loading tab content, render per-diff
descriptions, and steer recaps toward a labeled "Key changes" section.

- **Diff `summary` now renders as a description above the code** (previously a
  trailing note below it), so a one-line "what this hunk changes and why" reads
  before the diff — the natural order for a review recap.
- **`visual-recap` skill** now instructs the recap generator to give every
  `diff` a one-line `summary`, and to introduce a group of file diffs with a
  `## Key changes` rich-text heading rather than relying on a `tabs` block title.
  All four skill copies stay byte-identical (guarded by `skills.sync.spec.ts`).

These pair with a plan-template fix where switching tabs in a vertical `tabs`
block (the recap "Key changes" diff rail) reused one nested editor instance, so
its content reconciler skipped re-applying the newly-selected tab — surfacing as
"every tab shows the same diff" and a stuck "Loading diff block…". The nested
editor is now keyed per container region so each tab remounts with its own
content.
