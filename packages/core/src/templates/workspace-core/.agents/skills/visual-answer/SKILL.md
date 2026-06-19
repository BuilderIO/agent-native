---
name: visual-answer
description: >-
  Answer code/product questions as visual Plan artifacts using repo, bridge, or
  GitHub context; use for API specs, UI look, schema models, and architecture.
metadata:
  visibility: exported
---

# Visual Answer

`/visual-answer` turns a specific code or product question into a published
Agent-Native Plan artifact. It is for questions that need a visual, inspectable
answer rather than a chat paragraph: API contracts, schema/data models, UI
states, component behavior, architecture flows, and code evidence.

## When To Use

Use this skill when the user asks:

- "what is the API spec for this?"
- "what does this UI look like?"
- "what is the schema model for x?"
- "draw the flow for this code path"
- "show me the current shape of this component/API/data model"

For history questions about what changed or shipped, search merged PR recaps
first with `search-pr-recaps`, then pull a relevant hit into the conversation
with `show-visual-plan` (it renders that plan or recap's blocks inline). Reach
for `get-visual-plan` only when you need the full bundle/MDX to edit, not to
display. Use `visual-answer` when the current codebase, a local bridge, or
GitHub source needs to be inspected to produce a new answer.

## Workflow

1. Inspect the real source first. Use the host agent's repo tools, the Plan
   local bridge, or GitHub/source links. Do not invent endpoints, schema fields,
   UI states, file names, or behavior.
2. Call `get-plan-blocks` before authoring. Use the live registry, not memory.
   If the question asks what components are available, call
   `list-plan-components`.
3. Pick the evidence blocks:
   - API shape: `openapi-spec` plus `api-endpoint`; use before/after only when
     comparing historical changes from recaps.
   - UI look: `wireframe` or a `columns` before/after pair when comparing a
     recap.
   - Schema/data model: `data-model`, optionally with `diagram`.
   - Code evidence: `file-tree`, `tabs`, `annotated-code`, and `diff` when the
     answer depends on implementation details.
4. Publish with the Plan `visual-answer` action. Include the user's question,
   `repoPath`/`sourceUrl` when known, a concise title/brief, and MDX source
   under `mdx`.
5. In Agent-Native chat the published answer renders inline automatically — its
   blocks appear in the conversation. Add a one-line summary of the evidence plus
   the deep link; do not paste raw MDX or block source as text. (In terminal or
   external MCP hosts that cannot render the blocks, return the URL.)

## Terminal Handoff

When running from a terminal or coding-agent shell, write
`visual-answer-source.json`:

```json
{
  "question": "What is the billing API shape?",
  "title": "Billing API visual answer",
  "brief": "Shows the request and response contract.",
  "repoPath": "owner/repo",
  "sourceUrl": "https://github.com/owner/repo",
  "mdx": {
    "plan.mdx": "---\ntitle: Billing API visual answer\n---\n\n..."
  }
}
```

Then publish:

```sh
agent-native plan visual-answer publish --question "What is the billing API shape?" --source visual-answer-source.json --repo owner/repo
```

Use `--source-url` for a GitHub file/PR/commit/issue URL, `--prev-plan-id` to
refresh an existing answer, and `--visibility private` for owner-only output.
The command writes `visual-answer-url.txt`.

## Don't

- Do not use `visual-answer` for a plain implementation plan; use
  `visual-plan`.
- Do not use it for a PR diff recap; use `visual-recap`.
- Do not skip code inspection and infer from names alone.
- Do not publish screenshots, secrets, credential-looking values, or private
  source excerpts beyond what the user has asked to visualize.

## Related Skills

- `visual-plan`
- `visual-recap`
- `delegate-to-agent`
- `context-awareness`
