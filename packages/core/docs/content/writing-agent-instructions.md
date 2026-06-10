---
title: "Writing Agent Instructions & Skills"
description: "How to write great agent instructions for an agent-native app or template: AGENTS.md, skills, and tool descriptions."
---

# Writing Agent Instructions & Skills

The agent's behavior in an agent-native app is only as good as the instructions you give it. Three surfaces carry that guidance: `AGENTS.md` (the map), skills (the deep dives), and action/tool descriptions (how the agent picks the right tool). Write each one for fast retrieval, not for prose.

## Keep AGENTS.md small and skimmable {#small-agents-md}

`AGENTS.md` is loaded as orientation. It should be the smallest thing that lets the agent act correctly, with everything deep pushed into skills. Aim for these sections and little else:

- **Purpose line** — one sentence on what the app is and the primary workflow.
- **Core rules** — the handful of invariants that must always hold (data in SQL, operations go through actions, AI goes through the agent chat, schema changes are additive). Short, imperative bullets.
- **Application-state keys** — the `navigation`/selection/focus keys the agent reads to know what the user is looking at, with their shape.
- **Action table** — a compact table of action name to purpose.
- **Skills index** — a list of the skills that exist and when to read each one.

If a section grows past a screen, it belongs in a skill. `AGENTS.md` answers "what is this app and what can I do," not "how exactly do I do the hard thing."

```markdown
# Projects App

One workspace for projects, tasks, and notes. Agent and UI share the same SQL
data and the same actions.

## Core Rules

- Data lives in SQL via Drizzle. Use actions for all writes.
- All AI work goes through the agent chat; never call an LLM inline.
- Schema changes are additive only.

## Application State

- `navigation.view`: `home` | `project`
- `navigation.projectId`: selected project on a project page

## Actions

| Action           | Purpose                     |
| ---------------- | --------------------------- |
| `list-projects`  | List accessible projects    |
| `create-project` | Create a project            |
| `update-project` | Rename or archive a project |

## Skills

- `project-imports` — read before importing legacy CSV exports.
- `sharing` — read before exposing a project to other users.
```

## Single-source AGENTS.md {#single-source}

Keep one canonical instructions file: `AGENTS.md`. If a client expects `CLAUDE.md`, make it a symlink to `AGENTS.md` rather than a second copy. Two hand-maintained files drift, and the agent ends up with contradictory rules. One source of truth, linked where needed.

## SKILL.md frontmatter must say what AND when {#skill-frontmatter}

The `description` is the only thing the agent sees when deciding whether to read a skill. It must answer two questions: what the skill covers, and when to trigger it. A description that only describes the topic will not fire.

```markdown
---
name: project-imports
description: >-
  How to import projects from the legacy CSV export. Use when the user uploads
  a project CSV or asks to migrate projects from the old system.
---
```

- Lead with the capability, then add an explicit **"Use when…"** clause.
- Be slightly pushy — over-triggering beats a skill that never loads.
- Keep it under ~40 words; it is loaded into context on every conversation.

## Progressive disclosure {#progressive-disclosure}

Write the `SKILL.md` as the lean, must-know layer: the rule, how to do it, the do/don't list, and pointers. Push long examples, exhaustive field references, API quirks, and edge-case tables into `references/` files the agent reads only when it needs them.

```text
.agents/skills/project-imports/
├── SKILL.md            # rule + happy path + do/don't
└── references/
    └── csv-format.md   # full column spec, encodings, edge cases
```

This keeps the always-loaded surface small and lets depth scale without bloating context. See the [Skills Guide](/docs/skills-guide) for the full skill format.

## Write action-oriented tables {#action-tables}

The agent scans tables faster than prose. Prefer a table of name to purpose over paragraphs describing each operation. The same applies to state keys, field types, and any enumerable set. Tables are skimmable, diffable, and easy to keep in sync when you add an action.

## Write clear tool descriptions {#tool-descriptions}

Action descriptions are tool descriptions — they drive tool selection. Make each one a precise, single-purpose sentence:

- Say what it does and what it returns, not how it's implemented.
- Describe each parameter in its `.describe()` so the agent fills it correctly.
- One responsibility per action. If a description needs "and also…", split it.
- Mark read-only actions (`readOnly: true` or `http: { method: "GET" }`) so the agent knows they're safe to call freely.

```ts
defineAction({
  description: "Create a project. Returns the new project id and title.",
  schema: z.object({
    title: z.string().min(1).describe("Project title shown in the sidebar"),
  }),
  // ...
});
```

## Bake in anti-fabrication and verify-before-done {#anti-fabrication}

App instructions should make honesty and verification the default behavior:

- **Never fabricate.** If data isn't found or an action fails, say so and recover — don't invent results or claim success. Read the real value via an action or query before reporting it.
- **Verify before declaring done.** After a change, confirm it with a read-back (re-query the row, re-read the screen via `view-screen`) instead of assuming the write worked.
- **Recover, don't give up.** On a recoverable error (a failed query, a transient fetch), retry or fix the input rather than abandoning the task. Keep this separate from the anti-fabrication rule — don't conflate "don't make things up" with "stop at the first error."

Put these as core rules in `AGENTS.md` so they apply to every turn.

## The four surfaces the agent sees {#four-surfaces}

Every piece of guidance you author lands in one of four surfaces. Knowing which surface to use prevents duplication and misplaced detail:

| Surface                     | Who writes it             | When it's loaded                                       | What belongs there                                          |
| --------------------------- | ------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| `AGENTS.md` instructions    | You (developer)           | Every turn, as orientation                             | Purpose, core rules, state keys, action index, skills index |
| Skills (`SKILL.md`)         | You (developer)           | On demand when the agent decides the skill is relevant | Step-by-step how-to for a specific pattern, do/don't lists  |
| Action descriptions (tools) | You (developer)           | Every turn, as the tool list                           | What the action does, what it returns, parameter semantics  |
| `application_state` context | Your UI code (at runtime) | Every turn, as live app state                          | Current navigation, selection, focused object, URL          |

**Quick diagnosis:**

- "The agent keeps asking which record to act on even when one is open" → fix: write the current item ID into `application_state` (`navigation` key) from your UI. That's an `application_state` gap, not a skill gap.
- "The agent calls the wrong action or misuses a parameter" → fix: improve the action's `description` and `.describe()` on the parameter. That's a tool description fix, not a skill.

## What goes where {#what-goes-where}

- **AGENTS.md** — applies to the whole app, every turn: purpose, core rules, state keys, action index, skills index.
- **Skills** — reusable how-to for a specific pattern, loaded on demand. Applies to everyone working in the app.
- **Memory (`memory/MEMORY.md`)** — per-user preferences and corrections, not authored guidance.

## What's next {#whats-next}

- [Skills Guide](/docs/skills-guide) — the skill file format, framework skills, and app-backed skills.
- [Creating Templates](/docs/creating-templates) — how `AGENTS.md` and skills fit into a shippable template.
- [The four-area checklist](/docs/key-concepts#four-area-checklist) — the four-area model every feature must satisfy.
