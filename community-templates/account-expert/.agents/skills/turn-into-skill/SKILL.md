---
name: turn-into-skill
description: >-
  Capture a proven thread or workflow as a reusable Agent-Native skill and save
  it as a personal or organization resource. Use when a user invokes
  `/turn-into-skill` or asks to save a workflow for reuse.
user-invocable: true
scope: both
metadata:
  internal: true
---

# Turn Into Skill

This is a packaging-and-save workflow, not a request for a proposal. A skill
is the lightweight path for a repeatable job that mostly needs guidance and
existing app actions. Use `turn-into-app` when the job needs a dedicated UI,
new persistent domain state, or a distinct app route.

## Default behavior

- With no argument, use the current thread as the source.
- With a named skill, local workflow, transcript path, or attachment, read that
  source and package it immediately.
- Do not ask the user to restate context already present in the source.
- Default to a personal skill unless the user explicitly asks for a team,
  organization, or all-app skill, or passes `shared` as the scope.
- If the current thread only discusses creating a skill, do not package that
  meta-workflow unless the user explicitly asks for it.
- Treat an explicit `/turn-into-skill` invocation as authorization to save the
  resulting skill, but never overwrite an existing skill at the target path
  unless the user clearly asks to update it.

## 1. Extract the repeatable workflow

Read the full source before writing. Reduce it to a concise working brief:

- the repeatable job and the user outcome;
- when the skill should trigger;
- required inputs, context, permissions, and integrations;
- the ordered steps and the one to three judgment-heavy decisions;
- expected outputs, verification, retry, and failure boundaries.

Preserve the useful judgment from the source, not its transcript. Do not turn
one-off answers, private data, customer data, secrets, or unverified claims into
the skill's contract. If no repeatable job can be identified, stop and report
what is missing instead of inventing generic guidance.

## 2. Author the skill

Create a single `SKILL.md` with:

- a short hyphen-case name and a description under 40 words that says what the
  skill does and when to use it;
- `user-invocable: true` so it can be selected from the app's `/` picker;
- `scope: both` so the saved skill can guide the app runtime and connected
  coding agents;
- concise sections for purpose, trigger, inputs, workflow, verification, and
  failure or retry behavior.

Write imperative, reusable instructions. Keep exact action names, field rules,
and decision criteria when they matter. Use placeholders for credentials and
provider data. Do not paste the source transcript, large dumps, or ephemeral
thread details into the saved skill.

Choose a new slug when the target path already exists. Read an existing skill
before changing it, and update it only when the user explicitly requested an
update.

## 3. Save at the requested scope

Skills are resources at `skills/<slug>/SKILL.md`.

| User intent | Save path |
| --- | --- |
| Just me or personal reuse | Use the `resources` tool with `action: "write"`, `scope: "personal"`, `visibility: "workspace"`, and the generated skill content. |
| Shared organization or app reuse | Use the `resources` tool with `action: "write"`, `scope: "shared"`, `visibility: "workspace"`, and the generated skill content. |
| Every workspace app | Use `create-workspace-resource` with `kind: "skill"`, `scope: "all"`, the generated path, name, description, and content. |
| Only selected apps | Use the workspace resource flow with `scope: "selected"` only when the user names the app set. |

For an all-app workspace skill, use the workspace resource action when it is
available. If the current app does not expose it, discover or delegate to the
configured Dispatch workspace agent. Do not silently save a personal skill and
report it as shared. If organization approval is queued, report that the skill
is pending approval rather than claiming it is active.

Set `visibility: "workspace"` for an explicitly requested saved skill. Use
`agent_scratch` only for temporary drafting, then promote or rewrite it before
reporting the skill as saved.

## 4. Verify and hand off

After saving, read the exact `skills/<slug>/SKILL.md` resource back at the
target scope. Confirm that the frontmatter name, trigger description, and full
workflow body are present. If the read-back fails or the save returned an
approval request, say so plainly and include the actual pending state.

Report:

- the skill name and path;
- whether it is personal, organization-wide, or selected-app;
- the trigger users can invoke from `/`;
- the verification result and any approval or setup still required.

## Related skills

- `turn-into-app` — package the same source as a UI-bearing app with buttons,
  agent handoffs, and a domain workflow.
- `create-skill` — general skill format and authoring rules.
- `capture-learnings` — lightweight memory for preferences and corrections,
  rather than reusable workflows.
- `self-modifying-code` — safety boundaries when the agent edits app source.
