---
name: writing-edit-orchestrator
description: "Use this for long-form writing edits so work is chunked, subagent driven, and resumable after context compaction. Activate when editing drafts longer than 700 words, when multiple edit passes are needed (tone, structure, clarity), or when a session may span many turns."
---

# Writing Edit Orchestrator Skill

Use this skill for substantial writing revisions (articles, essays, reports, newsletters) where quality drops if edits are attempted in one pass.

Core idea: treat writing edits like code refactors with scoped tasks, explicit checks, and durable execution state.

## When to use

Use this skill when any of the following are true:

- Draft is longer than about 700 words.
- User asks for multiple classes of edits (tone, structure, clarity, transitions, etc.).
- Session may span many turns and risk context compaction.
- You are editing an existing draft rather than writing from scratch.

## Non-negotiable rules

1. Do not do a whole-document rewrite by default.
2. Decompose the task into bounded chunk edits first.
3. Use General subagents for chunk-level rewrites.
4. Keep one edit objective per pass (for example, conversational tone only).
5. Create durable plan/state files before substantive edits.
6. Keep plan/state files ephemeral and out of commits.

## Ephemeral planning files (required)

Before substantive edits, write both files in the repo's `.builder-writing` directory (create if it doesn't exist):

- Plan: `.builder-writing/<doc-slug>/edit-plan.md`
- State: `.builder-writing/<doc-slug>/edit-state.json`

Why this location:

- `.builder-writing` is meant to be an ephemeral location. You should clean it up before any PR.
- Files survive context compaction and can be reloaded on resume.

If these files do not exist, create them first. If they exist, update them before continuing.

## Resume protocol (after compaction/restart)

On resume, do this in order:

1. Reload this skill.
2. Read `.builder-writing/<doc-slug>/edit-plan.md`.
3. Read `.builder-writing/<doc-slug>/edit-state.json`.
4. Reconcile current document with state.
5. Continue from first incomplete chunk/task.

Do not re-plan from scratch unless the user asks for a new direction.

## Execution workflow

1. Confirm objective and non-goals from conversation.
2. Chunk the document into sections or 2-3 paragraph blocks.
3. Pick execution mode:
   - Parallel for independent local rewrites.
   - Sequential for cross-section dependency work.
   - Hybrid: parallel local rewrites, then sequential integration.
4. Write/update plan and state files.
5. Run chunk tasks with General subagents.
6. Apply edits carefully chunk by chunk.
7. Run integration pass (transitions, intro/conclusion alignment).
8. Run final QA pass against constraints/checklist.

## Parallel vs sequential decision rules

Use parallel when:

- Objective is local and repeated (more conversational, simpler sentences, tighter paragraphs).
- Chunks are mostly independent.

Use sequential when:

- Objective changes argument order, thesis framing, or narrative arc.
- Intro, body, and conclusion must be reshaped together.

Use hybrid by default for large edits:

- Phase 1: parallel chunk rewrites.
- Phase 2: sequential cohesion pass.
- Phase 3: sequential QA pass.

## Subagent task card format

For each chunk, pass a targeted task card to a General subaagent:

- Objective: single edit objective for this pass.
- Scope: exact section/chunk boundaries.
- Must keep: claims/facts/voice constraints that cannot change.
- Must avoid: banned patterns and non-goals.
- Output: revised chunk only plus short change notes.

Never ask a chunk General subagent to rewrite the entire draft.

## Integration pass requirements

After chunk rewrites complete:

- Smooth transitions between adjacent sections.
- Remove duplicated setup or repeated conclusions.
- Ensure intro promises match body delivery.
- Ensure conclusion reflects final argument.

Integration pass should preserve validated chunk content, not re-author the article.

## Final QA checklist

Before declaring done, verify:

- All required claims are still present.
- Non-goals remain intact (for example, no structural reordering if prohibited).
- Voice/tone constraints are satisfied.
- Length target is within agreed range.
- No obvious regressions in clarity or factual intent.

## Suggested `edit-plan.md` template

```md
# Edit Plan: <doc title>

## Source
- Document path: <path>
- Objective: <single objective for current pass>
- Non-goals: <what must not change>

## Decisions from user conversation
- <decision 1>
- <decision 2>

## Chunk map
1. <section/chunk boundary>
2. <section/chunk boundary>

## Execution mode
- Mode: parallel | sequential | hybrid
- Rationale: <why>

## Subagent assignments
- Chunk 1 -> <task summary>
- Chunk 2 -> <task summary>

## Integration plan
- <transition and cohesion steps>

## QA checklist
- [ ] Claims preserved
- [ ] Tone target met
- [ ] Length target met
- [ ] Transitions smoothed
```

## Suggested `edit-state.json` template

```json
{
  "doc_path": "<path>",
  "objective": "<current objective>",
  "mode": "parallel",
  "chunks": [
    { "id": "chunk-1", "scope": "<boundary>", "status": "pending" },
    { "id": "chunk-2", "scope": "<boundary>", "status": "pending" }
  ],
  "integration": { "status": "pending" },
  "qa": { "status": "pending" },
  "last_updated": "<iso-8601>"
}
```

## Git hygiene for this workflow

Plan/state files are ephemeral operational memory. Keep them out of PRs:

- Store them only under `.builder-writing/...`.
- Do not stage or commit anything from `.builder-writing/`.
- PR should include only user-facing document changes and relevant config/docs updates.
