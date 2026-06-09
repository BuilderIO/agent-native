---
"@agent-native/core": patch
---

Plan renderer + skill polish from review feedback:

- `checklist` block read view now wraps long item labels instead of clipping
  them off the right edge (`min-w-0 flex-1` body, `shrink-0` marker,
  `break-words`), and tightens the inter-item gap from `gap-3` to `gap-2`.
- Plan skill `DOCUMENT_QUALITY_CORE` (shared by `/visual-plan` and `/ui-plan`)
  now states that the bottom `question-form` is the ONLY place that enumerates
  open questions — a one-line pointer in the overview is fine, but the question
  list must not be reproduced as a second "Open Questions" section earlier in
  the document.
