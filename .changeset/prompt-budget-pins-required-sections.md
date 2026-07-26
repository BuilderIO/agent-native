---
"@agent-native/core": patch
---

Stop the compact startup-context budget from silently dropping required prompt
sections. `selectPromptSectionsWithinBudget` was greedy-with-skip over an
untyped `string[]`, so an app with large instruction files could exhaust the
48,000-character budget and lose the last section in the array — usually
`<available-apps>`, the only place the prompt says which peer apps exist. The
agent then reported cross-app work as impossible with no trace anywhere.

Sections now carry the `ContextGovernanceTier` the context manifest already
reports for them, and `required` sections (workspace-core `AGENTS.md`, the
on-demand context note, and `<available-apps>`) are reserved before
discretionary sections compete for the remainder. Omissions are logged with
each section's label and size, and the `<context-budget-note>` now names what
was dropped so the agent knows to re-read rather than assume absence. If
required sections alone exceed the budget they are sent whole and over budget —
a truncated list of workspace apps reads to the model as a complete one — and
the overflow is logged.
