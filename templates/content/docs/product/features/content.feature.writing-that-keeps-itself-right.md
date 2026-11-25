---
record_type: "feature"
id: "content.feature.writing-that-keeps-itself-right"
number: 34
name: "Writing that keeps itself right"
chapter: "content.chapter.working-systems"
order: 34
roadmap_status: "partially_implemented"
summary: "Put checks on a page so its writing keeps pointing at what doesn't pass, without anything changing the text."
example_workflow: 'An editor adds "Under 120 words" to a post''s intro, sees "183 words, 63 over" before saving the check, cuts the intro, and watches the dot beside it disappear a few seconds after they stop typing.'
works_today: "Count checks on the page, the intro, a section or each paragraph, with dots beside the text, a Checks list in Info, a header count, Check now, a recheck after typing stops, Skip here and Comment."
remains: "Yes/no questions answered by a model with How sure and limits, checks on each section with Only where, and checks on Collection rows."
required_capabilities: ["content.check.page"]
enhancing_capabilities: []
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-11-25"
---

# Feature 34: Writing that keeps itself right

Put checks on a page so its writing keeps pointing at what doesn't pass, without anything changing the text.

## Product contract

- **Checks:** A sentence on a page, like "Under 120 words", that marks every place in its scope that doesn't pass.
- **Answers:** Each place is fine, not fine, skipped, changed since the last check, or couldn't check with its reason, and no two look alike.
- **Running:** Check now, and a recheck a few seconds after typing stops; opening or reading a page runs nothing.
- **Acting:** Comment opens the ordinary comment box with the reason filled in; Skip here hides one place until its text changes.
- **Access:** Editors add, change and run checks; commenters read them; viewers and public readers get nothing.
