---
"@agent-native/core": patch
---

Make `plan local verify` validate plan content against the real renderer
schema, and stop `plan local check` from reporting false greens.

Previously both headless commands could pass a plan the renderer later rejects:
`check` ran a hand-rolled regex lint (a subset of the schema that never
inspected blocks authored as JSON inside a container's `tabs={[…]}` /
`columns={[…]}` array), and `verify` only checked bridge/CORS transport, never
the content. The plan then got stuck on "Loading plan" when rendered.

Now:

- `verify` POSTs the MDX folder to the Plan app's new, public, no-DB
  `validate-local-plan-source` action, which runs the renderer's own
  `parsePlanMdxFolder` + `planContentSchema`. Its verdict gates `verify`'s
  `ok`, and rejected plans surface the renderer's exact schema-path issue
  (e.g. `blocks[1].data.tabs[0].blocks[0].data.items[0].id`). When the endpoint
  is unavailable (older/unreachable Plan app), `verify` degrades to the
  transport checks and warns that content was not validated, rather than
  hard-failing.
- `check` now recurses into nested `tabs` block arrays so the common
  nested-checklist / question-form / missing-`id` case is caught offline, and
  it no longer reports `validation: "passed"`. It reports a clearly-scoped
  `lint-passed` with a note pointing to `verify` for authoritative validation.
