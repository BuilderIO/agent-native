---
"@agent-native/core": patch
---

Make `plan local check` catch every required `checklist`/`question-form` field
the Plan renderer enforces, not just per-item `id`. Previously a local plan
missing a checklist item `label`, or a question `title`/`mode`, or an option
`label`, passed `plan local check` with a false green and then got stuck on
"Loading plan" when the hosted renderer rejected it (`expected string`). The
lint now validates `id` + `label` on checklist items and options, and `id` +
`title` + a valid `mode` enum on questions, so authoring mistakes surface
locally before the browser handoff. The visual-plan/visual-recap skills now
spell out the full required-field set.
